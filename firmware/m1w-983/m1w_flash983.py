#!/usr/bin/env python3
"""Flash only the pinned official M1W device-983 v108 image.

Uses the vendor QF.upgrade wire protocol. No claim, detach, or USB reset.
Default invocation is read-only. An explicit --flash-official-v108 starts an
upgrade; --resume-session resumes the same pinned image in an existing boot.
"""
import argparse
import ctypes as C
import ctypes.util
import fcntl
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import time
import zlib

IMAGE_DIR = Path(__file__).resolve().parent
IMAGE_HASH = '7c8f0287d2d4dc916f88e68ad59e56544187faa8c5c008441a068d1922aa26c7'
PACK_HASH = '99e93a620c60745bff1e01d69a75055d2e25a3cfcfc87561db7d3c0edfb4b4a6'
NORMAL = {(0x3151, 0x4015)}
# This image's boot data at file 0x3358 contains 3151:4016 / bcd0729,
# matching the actual transition on the original physical port. The frontend's
# generic 4001 list is not the M1W SoC boot descriptor.
BOOT = {(0x3151, 0x4016)}
BOOT_VERSION = 0x0729
READ_CODES = (0x80, 0x85, 0x8f)
BUF = C.c_ubyte * 64
lib = None
LOCK_PATH = Path(f'/tmp/m1w-control-{os.getuid()}.lock')


class FlashError(RuntimeError):
    pass


def frame(data, checksum=False):
    if not 0 < len(data) <= 64:
        raise FlashError('Invalid frame size')
    value = bytearray(data) + bytearray(64 - len(data))
    if checksum:
        value[7] = 255 - (sum(value[:7]) & 255)
    return bytes(value)


def load_image():
    packed = (IMAGE_DIR / '983_v108.deflate').read_bytes()
    image = (IMAGE_DIR / '983_v108.bin').read_bytes()
    meta = json.loads((IMAGE_DIR / 'metadata.json').read_text())
    if (len(packed) != 86253 or hashlib.sha256(packed).hexdigest() != PACK_HASH
            or len(image) != 282912 or hashlib.sha256(image).hexdigest() != IMAGE_HASH
            or zlib.decompress(packed, -15) != image
            or meta['code'] != 0 or meta['data']['dev_id'] != 983 or meta['data']['version_str'] != 'v108'
            or image[0x3358:0x335e] != bytes.fromhex('513116402907')):
        raise FlashError('Official firmware identity, digest, or decompression mismatch')
    payload = image[65536:]
    if len(payload) != 217376 or len(payload) % 64 != 32:
        raise FlashError('Unexpected payload layout')
    return payload


class Descriptor(C.Structure):
    _fields_ = [('length', C.c_uint8), ('type', C.c_uint8), ('bcdUSB', C.c_uint16),
                ('deviceClass', C.c_uint8), ('subClass', C.c_uint8), ('protocol', C.c_uint8),
                ('packet0', C.c_uint8), ('vid', C.c_uint16), ('pid', C.c_uint16),
                ('bcdDevice', C.c_uint16), ('manufacturer', C.c_uint8),
                ('product', C.c_uint8), ('serial', C.c_uint8), ('configurations', C.c_uint8)]


def load_libusb():
    """Load only when USB is needed, so image checks and tests need no libusb."""
    global lib
    if lib is not None:
        return
    candidates = [ctypes.util.find_library('usb-1.0'),
                  '/opt/homebrew/opt/libusb/lib/libusb-1.0.0.dylib',
                  '/usr/local/opt/libusb/lib/libusb-1.0.0.dylib']
    for candidate in filter(None, candidates):
        try:
            library = C.CDLL(candidate)
            break
        except OSError:
            continue
    else:
        raise FlashError('libusb-1.0 not found; on macOS install it with: brew install libusb')

    library.libusb_init.argtypes = [C.POINTER(C.c_void_p)]
    library.libusb_init.restype = C.c_int
    library.libusb_exit.argtypes = [C.c_void_p]
    library.libusb_get_device_list.argtypes = [C.c_void_p, C.POINTER(C.POINTER(C.c_void_p))]
    library.libusb_get_device_list.restype = C.c_ssize_t
    library.libusb_free_device_list.argtypes = [C.POINTER(C.c_void_p), C.c_int]
    library.libusb_get_device_descriptor.argtypes = [C.c_void_p, C.POINTER(Descriptor)]
    library.libusb_get_device_descriptor.restype = C.c_int
    library.libusb_get_bus_number.argtypes = [C.c_void_p]
    library.libusb_get_bus_number.restype = C.c_uint8
    library.libusb_get_port_numbers.argtypes = [C.c_void_p, C.POINTER(C.c_uint8), C.c_int]
    library.libusb_get_port_numbers.restype = C.c_int
    library.libusb_open.argtypes = [C.c_void_p, C.POINTER(C.c_void_p)]
    library.libusb_open.restype = C.c_int
    library.libusb_control_transfer.argtypes = [C.c_void_p, C.c_uint8, C.c_uint8,
                                                C.c_uint16, C.c_uint16, C.c_void_p,
                                                C.c_uint16, C.c_uint]
    library.libusb_control_transfer.restype = C.c_int
    library.libusb_close.argtypes = [C.c_void_p]
    lib = library


class Device:
    def __init__(self, handle, identity):
        self.handle, self.identity = handle, identity

    def close(self):
        if self.handle:
            lib.libusb_close(self.handle)
            self.handle = None

    def write(self, data):
        if len(data) != 64:
            raise FlashError('Feature writes must be 64 bytes')
        buf = BUF.from_buffer_copy(data)
        n = lib.libusb_control_transfer(self.handle, 0x21, 9, 0x0300, 0, buf, 64, 2000)
        if n != 64:
            raise FlashError(f'SET_REPORT failed/short: {n}/64')

    def read(self):
        buf = BUF()
        n = lib.libusb_control_transfer(self.handle, 0xa1, 1, 0x0300, 0, buf, 64, 2000)
        if n != 64:
            raise FlashError(f'GET_REPORT failed/short: {n}/64')
        return bytes(buf)

    def query(self, opcode):
        if opcode not in READ_CODES:
            raise FlashError('Query not permitted')
        self.write(frame([opcode], True))
        for _ in range(4):
            time.sleep(0.02)
            response = self.read()
            if response[0] == opcode:
                return response
        raise FlashError(f'No echo for query {opcode:02x}')


class USB:
    def __init__(self):
        load_libusb()
        self.context = C.c_void_p()
        if lib.libusb_init(C.byref(self.context)) != 0:
            raise FlashError('libusb initialization failed')

    def devices(self, pairs, port=None, open_one=False):
        devices = C.POINTER(C.c_void_p)()
        count = lib.libusb_get_device_list(self.context, C.byref(devices))
        if count < 0:
            raise FlashError(f'USB enumeration failed: {count}')
        found = []
        handle = C.c_void_p()
        try:
            for i in range(count):
                desc = Descriptor()
                if lib.libusb_get_device_descriptor(devices[i], C.byref(desc)) != 0 or (desc.vid, desc.pid) not in pairs:
                    continue
                ports = (C.c_uint8 * 8)()
                n = lib.libusb_get_port_numbers(devices[i], ports, 8)
                if n <= 0:
                    raise FlashError('Cannot identify physical USB port')
                path = [int(lib.libusb_get_bus_number(devices[i])), *map(int, ports[:n])]
                if port is not None and path != port:
                    continue
                identity = {'vid': desc.vid, 'pid': desc.pid, 'bcdDevice': desc.bcdDevice, 'port': path}
                found.append(identity)
                if open_one and len(found) == 1:
                    result = lib.libusb_open(devices[i], C.byref(handle))
                    if result != 0:
                        raise FlashError(f'USB open failed: {result}')
            if open_one:
                if len(found) != 1:
                    if handle:
                        lib.libusb_close(handle)
                    raise FlashError(f'Expected one target on port {port}; found {len(found)}')
                return Device(handle, found[0])
            return found
        finally:
            lib.libusb_free_device_list(devices, 1)

    def wait(self, pairs, port, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if len(self.devices(pairs, port)) == 1:
                return self.devices(pairs, port, open_one=True)
            time.sleep(0.25)
        raise FlashError(f'Device did not enumerate on the original USB port in {seconds}s')

    def close(self):
        lib.libusb_exit(self.context)


def check_identity(device, expected_version=None):
    info = device.query(0x8f)
    revision = device.query(0x80)
    device_id = int.from_bytes(info[1:5], 'little')
    version = int.from_bytes(revision[1:3], 'little')
    if device_id != 983 or expected_version is not None and version != expected_version:
        raise FlashError(f'Device/firmware mismatch: ID {device_id}, version {version:04x}')
    return version


def write_json(path, data):
    with open(path, 'x', opener=lambda name, flags: os.open(name, flags, 0o600)) as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())


def send_image(device, payload, log, pause=time.sleep):
    count = (len(payload) + 63) // 64
    begin = frame(b'\xba\xc0' + struct.pack('<H', count) + len(payload).to_bytes(3, 'little'))
    # After this header the bootloader consumes every SET as raw image data.
    # Poll GET only; repeating a header could corrupt the first payload block.
    log('start-header-attempt', count=count)
    pause(0.01)
    device.write(begin)
    for attempt in range(30):
        pause(0.01 if attempt == 0 else 0.1)
        reply = device.read()
        if reply[:4] == b'\xab\xc0' + struct.pack('<H', count):
            log('start-reply', attempt=attempt+1, hex=reply.hex())
            break
    else:
        raise FlashError('Bootloader did not acknowledge the image header; no payload sent')
    pause(1)  # The vendor waits 1 second following the start reply.
    for index in range(count):
        chunk = payload[index*64:index*64+64]
        pause(0.01)  # NT.writeFeatureCmd default delay, including upgrade frames.
        try:
            device.write(frame(chunk))
        except Exception as error:
            log('payload-write-failed', index=index, error=str(error))
            raise FlashError(f'Frame {index}/{count} failed; transfer was not blindly retried') from error
        if index % 128 == 0 or index == count-1:
            log('payload-progress', sent=index+1, total=count, percent=round((index+1)/count*100, 1))
    checksum = sum(payload) & 0xffffff
    end = frame(b'\xba\xc2' + struct.pack('<H', count) + checksum.to_bytes(3, 'little') + len(payload).to_bytes(3, 'little'))
    pause(0.01)
    device.write(end)
    log('commit-sent', count=count, length=len(payload), checksum24=f'{checksum:06x}')
    for attempt in range(30):
        pause(0.005 if attempt == 0 else 0.1)
        try:
            reply = device.read()
        except FlashError as error:
            # Some boot builds leave USB immediately. Success then requires a
            # new normal-device connection with ID 983 and revision 0108.
            log('commit-reply-unavailable', error=str(error))
            return None
        if reply[:2] != b'\xab\xc2':
            continue
        log('commit-reply', hex=reply.hex())
        if reply[:4] != b'\xab\xc2' + struct.pack('<H', count) or reply[4] != 0x55 or int.from_bytes(reply[5:9], 'little') != 0:
            raise FlashError('Bootloader reported failed verification')
        return reply
    raise FlashError('No final verification reply; commit was not repeated')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--flash-official-v108', action='store_true')
    action.add_argument('--resume-session', type=Path)
    parser.add_argument('--session-dir', type=Path)
    args = parser.parse_args(argv)
    payload = load_image()
    lock = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    usb, device, journal = USB(), None, None

    def log(event, **values):
        data = {'event': event, 'time': time.time(), **values}
        print(json.dumps(data, ensure_ascii=False), flush=True)
        if journal:
            journal.write(json.dumps(data, ensure_ascii=False)+'\n')
            journal.flush()
            os.fsync(journal.fileno())

    try:
        if args.resume_session:
            directory = args.resume_session
            manifest = json.loads((directory/'manifest.json').read_text())
            if (manifest['imageSHA256'] != IMAGE_HASH or manifest['deviceID'] != 983
                    or manifest['sourceVersion'] != '0104' or manifest['targetVersion'] != '0108'):
                raise FlashError('Resume manifest does not match the pinned image')
            port = manifest['port']
            past = [json.loads(line) for line in (directory/'journal.jsonl').read_text().splitlines() if line]
            if any(item['event'] in ('start-header-attempt','start-reply','payload-progress','commit-sent') for item in past):
                raise FlashError('Cannot restart a partial download by repeating its start header; inspect and recover the existing session first')
            journal = (directory/'journal.jsonl').open('a')
            device = usb.devices(BOOT, port, open_one=True)
            log('resuming-existing-boot', identity=device.identity)
        else:
            if usb.devices(BOOT):
                raise FlashError('A boot device already exists; use its recorded session rather than guessing identity')
            device = usb.devices(NORMAL, open_one=True)
            version = check_identity(device)
            profile = device.query(0x85)[1]
            log('preflight', identity=device.identity, deviceID=983, installedVersion=f'{version:04x}', profile=profile, targetVersion='0108', payloadBytes=len(payload), imageSHA256=IMAGE_HASH)
            if not args.flash_official_v108:
                return
            if version == 0x108:
                log('already-target-version')
                return
            if version != 0x104:
                raise FlashError('This pinned upgrade was prepared for revision 0104 only')
            if profile != 0:
                raise FlashError('Switch to onboard profile 0 before using this updater')
            if args.session_dir is None:
                raise FlashError('--session-dir is required for the explicit upgrade')
            directory = args.session_dir
            directory.mkdir(mode=0o700, parents=True, exist_ok=False)
            journal = (directory/'journal.jsonl').open('x')
            port = device.identity['port']
            write_json(directory/'manifest.json', {'deviceID':983, 'port':port, 'normalUSB':device.identity, 'sourceVersion':'0104', 'targetVersion':'0108', 'imageSHA256':IMAGE_HASH})
            check_identity(device, 0x104)
            log('boot-entry-attempt', port=port)
            try:
                device.write(frame([0x7f,0x55,0xaa,0x55,0xaa], True))
            except FlashError as error:
                log('boot-entry-usb-result', error=str(error))
            device.close()
            device = None
            device = usb.wait(BOOT, port, 35)
            log('boot-enumerated', identity=device.identity)
        if device.identity['bcdDevice'] != BOOT_VERSION:
            raise FlashError(f"Unexpected bootloader revision: {device.identity['bcdDevice']:04x}")
        time.sleep(1)
        send_image(device, payload, log)
        device.close()
        device = None
        device = usb.wait(NORMAL, port, 35)
        time.sleep(1)
        check_identity(device, 0x108)
        log('version-verified', deviceID=983, installedVersion='0108', identity=device.identity)
        log('complete', installedVersion='1.08')
    except Exception as error:
        log('stopped', error=str(error))
        raise
    finally:
        if device:
            device.close()
        usb.close()
        if journal:
            journal.close()
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
