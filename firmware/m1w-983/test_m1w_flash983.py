import contextlib
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from shutil import copyfile
from unittest.mock import patch

import m1w_flash983 as flash


class Boot:
    def __init__(self, payload, fail_index=None, bad_start=False, bad_commit=False,
                 bcd_device=flash.BOOT_VERSION):
        self.payload=payload; self.frames=[]; self.fail_index=fail_index
        self.bad_start=bad_start; self.bad_commit=bad_commit
        self.count=(len(payload)+63)//64
        self.identity={'vid':0x3151, 'pid':0x4016, 'bcdDevice':bcd_device, 'port':[1,2,3]}

    def write(self, data):
        if len(self.frames)-1==self.fail_index:
            raise flash.FlashError('simulated uncertain transfer')
        self.frames.append(data)

    def read(self):
        if self.frames[-1][:2]==b'\xba\xc0':
            return flash.frame(b'\xab\xc0'+struct.pack('<H',self.count)) if not self.bad_start else bytes(64)
        return flash.frame(b'\xab\xc2'+struct.pack('<H',self.count)+bytes([0xaa if self.bad_commit else 0x55]))

    def close(self):
        pass


class Normal:
    def __init__(self, device_id=983, version=0x104, profile=0):
        self.device_id = device_id
        self.version = version
        self.profile = profile
        self.identity = {'vid':0x3151, 'pid':0x4015, 'bcdDevice':version, 'port':[1,2,3]}
        self.queries = []
        self.writes = []

    def query(self, opcode):
        self.queries.append(opcode)
        if opcode == 0x8f:
            value = self.device_id.to_bytes(4, 'little')
        elif opcode == 0x85:
            value = bytes([self.profile])
        else:
            value = self.version.to_bytes(2, 'little')
        return flash.frame(bytes([opcode]) + value)

    def write(self, data):
        self.writes.append(data)

    def close(self):
        pass


class FakeUSB:
    def __init__(self, normal, boot=None, final=None):
        self.normal, self.boot, self.final = normal, boot, final
        self.waits = []

    def devices(self, pairs, port=None, open_one=False):
        if pairs == flash.BOOT:
            if open_one:
                if self.boot is None or self.boot.identity['port'] != port:
                    raise flash.FlashError('Boot device is not on the recorded port')
                return self.boot
            return []
        return self.normal if open_one else [self.normal.identity]

    def wait(self, pairs, port, seconds):
        self.waits.append((pairs, port, seconds))
        return self.boot if pairs == flash.BOOT else self.final

    def close(self):
        pass


class FirmwareTests(unittest.TestCase):
    def run_image(self, boot):
        return flash.send_image(boot,boot.payload,lambda *a,**k:None,pause=lambda _:None)

    def test_official_package_digest_and_exact_payload(self):
        payload=flash.load_image()
        self.assertEqual(len(payload),217376)
        self.assertEqual((len(payload)+63)//64,3397)
        self.assertEqual(sum(payload)&0xffffff,0xaa51d3)

    def test_raw_chunks_padding_header_and_checksum(self):
        payload=bytes(range(96)); boot=Boot(payload)
        self.run_image(boot)
        self.assertEqual(boot.frames[0][:7],b'\xba\xc0\x02\x00\x60\x00\x00')
        self.assertEqual(boot.frames[1],payload[:64])
        self.assertEqual(boot.frames[2],payload[64:]+bytes(32))
        self.assertEqual(boot.frames[-1][:10],b'\xba\xc2\x02\x00'+sum(payload).to_bytes(3,'little')+b'\x60\x00\x00')

    def test_bad_start_never_sends_payload(self):
        boot=Boot(bytes(range(96)),bad_start=True)
        with self.assertRaises(flash.FlashError): self.run_image(boot)
        self.assertEqual(len(boot.frames),1)
        self.assertTrue(all(data[:2]==b'\xba\xc0' for data in boot.frames))

    def test_uncertain_payload_transfer_stops_without_retry_or_commit(self):
        boot=Boot(bytes(range(96)),fail_index=1)
        with self.assertRaises(flash.FlashError): self.run_image(boot)
        self.assertEqual(len(boot.frames),2)
        self.assertNotIn(b'\xba\xc2', [data[:2] for data in boot.frames])

    def test_failed_verification_is_not_success(self):
        boot=Boot(bytes(range(96)),bad_commit=True)
        with self.assertRaises(flash.FlashError): self.run_image(boot)

    def test_pinned_identity_rejects_other_model_and_version(self):
        with self.assertRaises(flash.FlashError): flash.check_identity(Normal(device_id=1),0x104)
        with self.assertRaises(flash.FlashError): flash.check_identity(Normal(version=0x105),0x104)
        # The device ID is 32-bit; matching its low 16 bits must not pass.
        with self.assertRaises(flash.FlashError): flash.check_identity(Normal(device_id=983 + 65536),0x104)

    def test_modified_firmware_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ('983_v108.deflate', '983_v108.bin', 'metadata.json'):
                copyfile(flash.IMAGE_DIR/name, target/name)
            image = target/'983_v108.bin'
            data = bytearray(image.read_bytes())
            data[-1] ^= 1
            image.write_bytes(data)
            with patch.object(flash, 'IMAGE_DIR', target), self.assertRaises(flash.FlashError):
                flash.load_image()

    def test_boot_entry_checksum_matches_vendor(self):
        self.assertEqual(flash.frame([0x7f,0x55,0xaa,0x55,0xaa],True)[:8],bytes.fromhex('7f55aa55aa000082'))


class WorkflowTests(unittest.TestCase):
    def run_main(self, directory, usb, args):
        original_send = flash.send_image
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(flash, 'LOCK_PATH', Path(directory)/'lock'))
            stack.enter_context(patch.object(flash, 'USB', return_value=usb))
            stack.enter_context(patch.object(flash.time, 'sleep', return_value=None))
            stack.enter_context(patch.object(flash, 'send_image',
                side_effect=lambda d,p,log: original_send(d,p,log,pause=lambda _:None)))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            return flash.main(args)

    def test_default_is_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            normal = Normal()
            self.run_main(directory, FakeUSB(normal), [])
            self.assertEqual(normal.queries, [0x8f, 0x80, 0x85])
            self.assertEqual(normal.writes, [])
            self.assertEqual({p.name for p in Path(directory).iterdir()}, {'lock'})

    def test_successful_upgrade_uses_session_log_without_configuration_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            normal, final = Normal(), Normal(version=0x108)
            boot = Boot(flash.load_image())
            usb = FakeUSB(normal, boot, final)
            session = Path(directory)/'session'
            self.run_main(directory, usb, ['--flash-official-v108', '--session-dir', str(session)])
            self.assertEqual(normal.writes, [flash.frame([0x7f,0x55,0xaa,0x55,0xaa], True)])
            self.assertEqual(normal.queries, [0x8f, 0x80, 0x85, 0x8f, 0x80])
            self.assertEqual(final.queries, [0x8f, 0x80])
            self.assertEqual(boot.frames[0][:2], b'\xba\xc0')
            self.assertEqual(boot.frames[-1][:2], b'\xba\xc2')
            self.assertEqual({p.name for p in session.iterdir()}, {'manifest.json', 'journal.jsonl'})
            entries = [json.loads(line) for line in (session/'journal.jsonl').read_text().splitlines()]
            self.assertEqual(entries[-1]['event'], 'complete')

    def test_unsupported_version_never_enters_boot(self):
        with tempfile.TemporaryDirectory() as directory:
            normal = Normal(version=0x105)
            session = Path(directory)/'session'
            with self.assertRaises(flash.FlashError):
                self.run_main(directory, FakeUSB(normal), ['--flash-official-v108', '--session-dir', str(session)])
            self.assertEqual(normal.writes, [])
            self.assertFalse(session.exists())

    def test_already_current_firmware_is_not_reflashed(self):
        with tempfile.TemporaryDirectory() as directory:
            normal = Normal(version=0x108)
            session = Path(directory)/'session'
            self.run_main(directory, FakeUSB(normal), ['--flash-official-v108', '--session-dir', str(session)])
            self.assertEqual(normal.writes, [])
            self.assertFalse(session.exists())

    def test_other_onboard_profile_never_enters_boot(self):
        with tempfile.TemporaryDirectory() as directory:
            normal = Normal(profile=1)
            session = Path(directory)/'session'
            with self.assertRaisesRegex(flash.FlashError, 'profile 0'):
                self.run_main(directory, FakeUSB(normal), ['--flash-official-v108', '--session-dir', str(session)])
            self.assertEqual(normal.writes, [])
            self.assertFalse(session.exists())

    def test_unknown_boot_revision_does_not_receive_firmware(self):
        with tempfile.TemporaryDirectory() as directory:
            normal = Normal()
            boot = Boot(flash.load_image(), bcd_device=0x0730)
            session = Path(directory)/'session'
            with self.assertRaisesRegex(flash.FlashError, 'Unexpected bootloader revision'):
                self.run_main(directory, FakeUSB(normal, boot), ['--flash-official-v108', '--session-dir', str(session)])
            self.assertEqual(boot.frames, [])

    def test_resume_never_restarts_partial_transfer(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)/'session'
            session.mkdir()
            (session/'manifest.json').write_text(json.dumps({
                'deviceID':983, 'port':[1,2,3], 'sourceVersion':'0104',
                'targetVersion':'0108', 'imageSHA256':flash.IMAGE_HASH,
            }))
            (session/'journal.jsonl').write_text(json.dumps({'event':'start-header-attempt'})+'\n')
            with self.assertRaisesRegex(flash.FlashError, 'Cannot restart a partial download'):
                self.run_main(directory, FakeUSB(Normal()), ['--resume-session', str(session)])

    def test_resume_before_transfer_uses_recorded_boot_port(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)/'session'
            session.mkdir()
            (session/'manifest.json').write_text(json.dumps({
                'deviceID':983, 'port':[1,2,3], 'sourceVersion':'0104',
                'targetVersion':'0108', 'imageSHA256':flash.IMAGE_HASH,
            }))
            (session/'journal.jsonl').write_text(json.dumps({'event':'boot-entry-attempt'})+'\n')
            boot, final = Boot(flash.load_image()), Normal(version=0x108)
            self.run_main(directory, FakeUSB(Normal(), boot, final), ['--resume-session', str(session)])
            self.assertEqual(boot.frames[0][:2], b'\xba\xc0')
            self.assertEqual(boot.frames[-1][:2], b'\xba\xc2')
            entries = [json.loads(line) for line in (session/'journal.jsonl').read_text().splitlines()]
            self.assertEqual(entries[-1]['event'], 'complete')


if __name__=='__main__': unittest.main()
