# MonsGeek / RongYuan M1W 控制协议

> **2026-10-30 更新：M1W 983 固件 1.08 已通过 WebHID 蓝牙通道验证基础层、Fn 单键的写入、读回及还原，详见 §11。**
> 浏览器端可读取状态、手动保存配置、修改灯效、组合键、宏和单键映射，无需原版驱动。
> 此结论针对 3151:4015、设备 983；Fn 组合的物理触发和宏实际播放仍待验证。

本文保留了早期原生工具研究记录；`native/`、`research-artifacts/` 和 `tools/` 等路径指原研究工作区，不属于本 Web 仓库。继续实验前先读 §8；WebHID 和软件灯光的最新结论见 §10。

## 0. 可直接使用的成果

- 原生 App：`native/dist/M1W Control.app`，源码与构建说明见 `native/README.md`。
- Swift 库：`native/Sources/M1WCore/`；C/IOKit 后端：`native/Sources/CM1WUSB/`。
- JSON CLI：`native/.build/release/m1wctl`。
- Python 查询工具：`tools/m1w_direct.py`，已修复校验、陈旧响应和错误备份问题；此版本仍使用 libusb。
- 真机记录：`research-artifacts/2026-10-28/native-validation.json`、`native-features-validation.json`。
- 双读一致的原始键位表：`research-artifacts/2026-10-28/keymap-profile0-verified.bin`。
- 早期实验完整备份：`research-artifacts/2026-10-28/native-backups/`，现在日常设置不自动保存文件。
- 官方固件包、升级路径及检测误报分析：`firmware-research.md`。

原生 App 支持有线 USB、配置 0 的基础层，含原驱动键盘图、准确点击区域、映射分类搜索、组合键、宏编辑、旋钮三个动作、灯效实时同步、手动保存/切换配置和显式恢复默认。1.08 上的 Fn 写入及宏绑定验证记录见 §5。无线控制未纳入此版本。

## 1. 证据来源与修正

用户提供的原版 App：

```
MonsGeek Driver.app/Contents/Resources/app/
  dist/static/js/main_b8c599f5.js  # 前端：帧、布局、默认矩阵、功能编码
  dist/static/images/yc500_m1wnosled_soc_e834ace0.png
  iot_driver                      # Rust/x86_64：USB 后端与校验实现
```

原版前端 SHA-256：`16a951efa13b9ff38b1d4cb5f3edde586efbb2f455d5191b8c4d4c136d22ca82`。
原版 driver SHA-256：`dde385a175aa24f63f7a20eb021594d03776b7040e2481e446644ec358a419a9`。

前端设备分派：`yc500_m1w_soc` / `yc500_m1wnosled_soc` → `CNt`。
继承链：`CNt → bHe → CXe → QM → _M → sM → QF → TF → pF → qT → NT`。
其中 `QM` 提供灯效与基础设置，`CXe` 提供单键写入，`CNt` 指定这款 M1W 的默认矩阵。
可读源码摘录及偏移在 `research-artifacts/2026-10-28/app-frontend/`；提取脚本 `tools/extract_m1w_protocol.py` 只解析文本，不执行 JS。

修正要点：

1. **校验枚举是 `BIT7=0, BIT8=1, NONE=2`**。旧文档误把 0 当作 NONE；旧 gRPC 客户端能工作，是因为 daemon 实际替它补了 BIT7 校验。
2. **macOS 的正常路径不需要抢占接口**。原 driver 的 `HidLibusb::new` 仅枚举/open，SET/GET 直接走 EP0；包含 detach 字符串并不能证明实际调用过 detach。反汇编存于 `original-driver-hid-libusb.asm`。
3. 无校验的 `80 00…` 虽能完成 USB 传输，却不会触发版本应答；补 `frame[7]=7f` 后立刻得到 `80 04 01…7f`。这不是权限失败。
4. **GET_KEYMATRIX 的返回值全是原始数据**，没有命令回显和块头。旧备份中重复的 `03 00 83 01…` 不是有效键位表。
5. **纯白需转换为 FAFAFA**。原前端明确做此转换；本机直接写 FFFFFF 会被固件替换成 B4B4B4。
6. **macOS 单键写入后等待 500 ms**。原前端 `hm()` 明确如此；80 ms 的首次实验导致读回不一致，按官方延迟修正后通过。

官方 libusb 的 [Darwin 源码](https://github.com/libusb/libusb/blob/master/libusb/os/darwin_usb.c)也说明 detach/capture 会引入 entitlement/root 要求；这与已验证的普通 EP0 路径不同，不应主动添加抢占操作。

## 2. 设备与 USB 线格式

目标：RongYuan yc500 M1W，VID `3151`、PID `4015`、设备 ID **983**、产品串 `MonsGeek Keyboard`、厂商串 `ROYUAN`，固件 1.04。它不兼容现有 HFD/QMK M1W VIA 固件；这不等于排除了为本芯片重新移植 QMK 的可能性。

- 接口 0：标准键盘。
- 接口 1：Consumer/System/键盘/鼠标等复合集合，另有厂商通知报告。
- 接口 2：厂商 Feature 报告集合，64 字节、无 Report ID。
- 没有命令 OUT 端点；控制命令走 EP0。

**原 driver 实际使用的控制传输：**

| 字段 | 写入查询/设置帧 | 读取应答 |
|---|---|---|
| bmRequestType | `0x21` | `0xA1` |
| bRequest | `0x09` SET_REPORT | `0x01` GET_REPORT |
| wValue | `0x0300`：Feature，Report ID 0 | `0x0300` |
| wIndex | **0** | **0** |
| wLength | **64** | **64** |
| timeout | 2000 ms | 2000 ms |

接口 2 的描述符位置不能直接当作这里的 wIndex。EP0 载荷就是 64 字节帧，**不要再在前面加 Report ID 字节**。65 字节是部分 HID API 的缓冲区表示方式。

原生实现：枚举 `IOUSBHostDevice` → `IOCreatePlugInInterfaceForService` → `IOUSBDeviceInterface320` → `USBDeviceOpen` → `DeviceRequestTO` → close/release。只使用系统框架。

## 3. 帧、校验、应答

默认请求为 64 字节，不足补零；命令位于字节 0。

```text
BIT7（枚举 0）: frame[7] = 0xFF - (sum(frame[0:7]) & 0xFF)
BIT8（枚举 1）: frame[8] = 0xFF - (sum(frame[0:8]) & 0xFF)
NONE（枚举 2）: 不自动修改帧
```

普通查询示例：

```text
TX: 80 00 00 00 00 00 00 7f [余下补零]
RX: 80 04 01 00 00 00 00 7f [余下补零]  # 版本 0x0104 → 1.04
```

短应答通常回显命令，但其中校验位可能只是请求头残留，不能一概当作“对返回数据重新计算的 CRC”。客户端检查长度和命令回显；陈旧帧不得当成功返回。矩阵块为例外，按 §5 处理。

## 4. 已知命令

| CMD | 名称 | 当前证据 |
|---|---|---|
| `80` | GET_REV | 原生真机，1.04 |
| `84` | GET_REPORT | 原生真机，原始档位字节 1 |
| `85` | GET_PROFILE | 原生真机，字节 1 为当前配置，实测 0 |
| `86` | GET_KBOPTION | 原生真机，`86 00 12 00…79` |
| `87` | GET_LEDPARAM | 原生真机，灯效字段见 §6 |
| `89` | GET_KEYMATRIX | 原生真机，8 × 64 字节纯数据 |
| `90` | GET_FNKEYMATRIX | 真机读取 selector 0/1 返回相同 512B；不据此推断为两个独立 Fn 层 |
| `8B` | GET_MACRO | 真机读取 4 × 64B 原始数据，槽号 0…49 |
| `8F` | GET_INFO | 真机 `8f d7 03 …`，LE 设备 ID 983 |
| `91` | GET_DEBOUNCE | 原生真机，字节 2 为 1 |
| `92` | GET_SLEEPTIME | 原生真机，BT/2.4G 浅睡 120/120 秒，深睡 900/600 秒 |
| `07` | SET_LEDPARAM | 原生真机写入、读回、还原通过；BIT8 |
| `06` | SET_KBOPTION | 真机切换独立关灯位并还原；BIT7 |
| `13` | SET_KEYMATRIX_SIMPLE | 原生真机 F12 → F11/Command+C、单记录变化及还原通过；BIT7 |
| `09` | SET_KEYMATRIX | 前端源码：9 块 × 56 字节；本次未实写整表 |
| `15` | SET_FN_SIMPLE | 1.08 真机 Fn+F12 临时写入、读回与原值还原通过，普通层未变化；尚未测试物理触发 |
| `16` | SET_MACRO_SIMPLE | 真机空闲槽49的写入、清零及读回通过 |
| `0B` | SET_MACRO | 旧整块方式，仅源码 |
| `02` | SET_RESET | 源码和模拟设备测试；未在真机执行 |
| `11` / `12` | SET_DEBOUNCE / SET_SLEEPTIME | 前端源码；本次未实写 |
| `83/88/8A` | 电量/休眠灯/键使能查询 | 已知查询；当前原生 App 不依赖这些字段 |

没有探测或使用复位、bootloader、固件擦写等命令。表中源码存在的通用命令不意味着这块 M1W 的每项功能都已支持或验证。

## 5. 键位与布局

### 读取

```text
请求：[89][profile=0][chunk=0…7][0][0][0][0][BIT7 checksum]…
应答：64 字节原始矩阵数据，无命令回显、无块头
```

8 块拼接为 **512 字节 = 128 个四字节记录**。默认表最后 8 字节为零；传统整表写入覆盖前 504 字节。
原生客户端每块读取前先查询版本建立不同的应答基线，以识别未更新的寄存器；再完整读取两遍，完全相同才接受备份。
真机原始备份与原版 App 的默认矩阵逐字节一致。

常见普通按键为 `[00,00,HID_usage,00]`；例如 Esc=`00 00 29 00`，F12=`00 00 45 00`。type 0 实际还可存最多三个同时按下的 usage，不能把末两字节统一当作16位 usage。媒体键、Fn、厂商功能使用其他类型字节，必须保留完整四字节。

### 单键写入（已验证）

```text
byte 0: 0x13
byte 1: profile（当前实现只允许 0）
byte 2: 矩阵记录编号（不是 HID usage，也不是字节偏移）
byte 3…6: 0
byte 7: BIT7 校验
byte 8…11: 新的四字节按键记录
byte 12…63: 0
```

F12 的矩阵编号 **78**，原记录 `00 00 45 00`；临时写成 F11 的 `00 00 44 00`，双读矩阵确认只有该记录变化，随后已还原。
每次单键写入之后按原前端规则等待 **500 ms**，再发其他命令。

### 组合键、旋钮和灯光功能

原前端组合编码 `[0,modifierUsage,primaryUsage,extraUsage]`；Command+C=`00 e3 06 00`，真机写入/读回并还原通过。修饰位是 HID usage（Control E0、Shift E1、Option E2、Command E3），不是位掩码。附加位置可放第二个修饰键或普通键，最多三个同时按下的 usage。

旋钮逆时针 index94=`03 00 ea 00`（音量减），顺时针95=`03 00 e9 00`（音量加），按下6=`0a 0e 00 00`（切换音量/灯光亮度）。UI 优先按功能表解码，避免只显示物理“旋钮”名称。

原厂 Fn 灯光记录：开关 `0a 09 00 00`；亮度加/减 `0d 02 01/02 00`；速度加/减 `0d 03 02/01 00`；方向左/右 `0d 05 00 02/01`；颜色循环 `0d 05 01 00`。Home/PgUp/PgDn/End 灯效组为 `0d 01 04/05/06/07 00`。

### Fn 与宏

Fn 读取 `[90,selector,chunk0…7]`，返回纯64B块。单键设置与13同形，opcode改15、selector在byte1。本机读取selector0/1相同，当前只保存selector0，不宣称两个独立层都能编辑。

2026-10-28 在设备 983 / 固件 1.08 上，将 Fn 表编号 78 从 `03 00 e9 00` 临时改为 `03 00 ea 00`。读回显示 Fn 表只有该记录改变、普通矩阵完全不变；随后写回原值并再次确认两张矩阵均与测试前一致。测试使用 EP0，不涉及 WebHID 的实际触发或宏播放，也未创建配置文件。

同日用未引用且原内容为空的宏槽 49 写入按键事件，再把 Fn 表编号 78 临时绑定为 `09 00 31 00`。宏内容和 Fn 绑定读回一致，普通矩阵未变；测试后恢复 Fn 原值及空宏槽并逐项复查。此次没有实际触发宏，也没有测断电持久化。

宏槽0…49，每槽256B；读取 `[8b,slot,chunk0…3]`，每块64B纯数据。设置16为 `[16,slot,chunk,56,lastFlag,0,0,checksum] + 56B`，最多5块，最后一块标志1；本实现写满5块并补零，以清除旧尾部。每块后20ms，结束500ms。空闲槽49写入测试数据、再还原全零，已真机读回。

宏前2B为重复次数LE16，键盘事件显式格式 `[usage,down?80:00,delayLE16]`；flags低7位非零时为2B紧凑事件，其低7位就是延时。四个零字节结束。绑定记录 `[09,playback,slot,00]`，playback=0指定次数/1再次按下停止/2按住重复。新宏分配前检查基础层/Fn引用，避免覆盖其他按键共用的槽。编辑器目前只处理键盘事件；原始宏可随手动配置保存，不承诺其他事件可编辑。

### 整表写入（仅源码）

9 帧，每帧 8 字节头 + 56 字节数据：`[09,profile,F8,01,chunk,00,00,checksum] + data56`。
头部自带 BIT7 校验，前端调用 NONE 避免再次修改。共 504 字节；本次 App 使用更小的单键写入，未验证这条整表通路。

### 还原原驱动的键盘外观

官方前端给出 **82 个按键 + 旋钮逆时针/按下/顺时针 = 85 个可操作区域**，包含名称、x/y、宽高。
代码中的 y 为负数，显示时取反。每个区域的原始值与默认四字节矩阵记录匹配，从而得到准确矩阵编号。

`tools/extract_m1w_protocol.py` 自动导出 `native/Sources/M1WCore/Resources/m1w.json`，并复制原包里的键盘 PNG 到同目录；不需要用户截图，也不依赖原版 App 运行或安装。原生界面使用该底图、代码中的区域坐标和从真机读回的映射，显示选中键与改键标记。

## 6. 灯效读写与纯白编码

读取：发 BIT7 `0x87` 查询；返回前 8 字节为：

```text
87 mode speed_wire brightness options R G B
```

设置：命令改为 `0x07`，字段布局相同，**字节 8 放 BIT8 校验**，不能覆盖作为 B 分量的字节 7。设置后等待 500 ms，再查询并比较。

- 亮度：0–4。
- 界面速度：0–4；线上速度 = `4 - 界面速度`。
- options 低 4 位：7 为彩虹、8 为自定义 RGB；高 4 位为模式相关方向等选项。
- 低4位0…6为该子类的预置颜色表：FF0000/00FF00/0000FF/FF5500/7700FF/FFFF00/FFFFFF，界面按索引解码。
- 常见 mode：0 关闭、1 常亮、2 呼吸、3 霓虹、4 波浪、5 涟漪、7 贪吃蛇、17 雨落、18 流星、23 列车、24 烟花。其他模式参数以对应前端分支为准。
- **纯白逻辑值 FFFFFF → 写入 FAFAFA；读到 FAFAFA → 显示 FFFFFF**，与原前端一致。

初始状态：模式 4、线上速度 2、亮度 4、options=7、RGB=FFFFFF。
首次直接写 FFFFFF 后，固件把 RGB 改成 B4B4B4；按官方规则改写 FAFAFA 后正常。
测试结束已恢复原来的模式、速度、亮度、彩虹和逻辑白色。原始白色字节由初始 FFFFFF 变成了原前端使用的规范编码 FAFAFA，未声称逐字节恢复初始的非规范白色表示。
最终灯效/改键往返验证在规范编码下前后原始应答也完全一致。

**历史灯光实验：** GET86=`[86,profile,flags,fnFlags,powerSave,…]`，flags bit4（0x10）为独立门控，bit1（0x02）为 Mac 模式。早期原生工具曾尝试用 SET06 调整门控；后来在 1.08 上验证软件关灯应使用 07 帧，软件开关灯不应触碰 06。以 §10 的修正结论为准。

界面每2秒只读85/86/87以同步硬件快捷键改动，编辑草稿独立保存；改键操作更新对应缓存记录，外部程序改键需点击刷新。

## 7. 原生实现和测试

`M1WCore` 将普通写入与手动配置保存分开。**用户明确要求日常不自动备份、不写配置文件**，覆盖旧版备份约束。普通改键只读相关64B页前后；灯效只读状态。写后不符时尝试从内存原值还原，并报告结果。进程锁防止自己的实例争用 USB。

只有用户点保存或显式CLI backup才全量双读，schema2保存名称、基础层、Fn0、已引用宏和灯效/选项，兼容旧schema1。保存目录为 `~/Library/Application Support/M1W Control/Profiles/`。切换只写不同的记录并读回验证；不是原厂板载profile命令。恢复默认02只在显式确认后执行一次，等待4秒，不自动重发、不自动备份；没有在本机清空配置测试。

```sh
cd path/to/m1w/native
swift test
bash build-app.sh
.build/release/m1wctl info
.build/release/m1wctl light --brightness 3
.build/release/m1wctl remap F12 F11
.build/release/m1wctl restore /path/to/backup.json
```

当前 29 项自动测试全部通过，覆盖帧、BIT7/BIT8、颜色、布局、旋钮、组合键、灯光门控、宏编码/分块/绑定、手动配置完整切换和失败还原。
本机 ARM64/IOKit 真机结果见 `research-artifacts/2026-10-28/native-validation.json`：亮度变化、F12 → F11 的单记录变化和还原都通过。
初始失败记录分别保留在 `native-validation-before-white-fix.json` 和 `native-validation-before-key-delay-fix.json`。
新功能实测见 `native-features-validation.json`：组合键0.623秒、宏槽写入1.437秒、关灯后应用并开启1.139秒；原值全部还原。恢复默认只做模拟和弹窗取消验证。

## 8. 实验安全约束

- **禁止盲发未知请求，尤其是非查询命令、不同 recipient/request/value 的矩阵扫描。** 旧实验曾使键盘暂时失灵，拔插才恢复。历史 `research-artifacts/usbtalk.c` 包含这种扫描，禁止直接运行。
- **日常不自动备份，按用户最新要求只手动保存配置。** 实验先在内存保留被改字段并及时还原。旧 `research-artifacts/m1w_keymap.bin` 和旧 gRPC 重复帧不能作恢复依据。
- 普通查询白名单：`80/83/84/85/86/87/88/89/8A/8B/8F/90/91/92`；块读取走专用函数。已真机实写06/07/13/15/16，02只有源码/模拟证据。
- 不 claim/detach/seize，不改变 USB 配置，不卸载系统驱动，不停止用户的其他设备服务。
- 不刷现有WB32 `m1w-port` 或HFD v23.2。原厂升级入口已静态找到，但boot含接收循环前擦除路径，未作为设备探测执行；详见 `firmware-research.md`。
- 失联/拔线时不保证能还原。报告原始错误及还原结果，不能把成功的USB返回值当作配置成功。

## 9. 历史材料与后续范围

旧架构：Electron/网页 → 本地 gRPC-web → Intel `iot_driver` → USB。旧 RPC 客户端 `tools/m1w_client.py` 只作为历史研究工具保留。
原 gRPC 服务 `driver.DriverGrpc` 的 sendMsg/readMsg/sendRawFeature/readRawFeature 仍有分析价值；校验枚举须使用本文修正值。旧本地 DB 配置路径为 `~/Library/Application Support/MonsGeek Driver/iot_db/CONFIG`。

当前 App 自带布局和原生 USB 实现，完全不调用该 RPC 服务，也不打开网络监听端口。

该阶段尚未完成：Fn 组合物理触发、宏实际播放、其他配置档、无线配置、电量语义和断电持久化。Fn 单键写入已在 1.08 上读回验证并还原；宏槽写入已经通过。后续蓝牙测试见 §11。本机控制无须替换原厂固件。

## 10. WebHID 通路（2026-10-28 验证）

Web 版控制已两关实测可行：

- **固件忽略 wIndex**：`tools/windex_probe.c` 用白名单 80 查询在 wIndex=0/1/2 各测一次，SET/GET 均返回 `80 08 01 00 00 00 00 7f`；EP0 hook 只看 bmRequestType/bRequest/wValue/wLength。SET_REPORT 在 wIndex=2 同样被接受，06/07/13/16 等写命令按同一 handler 推断无碍，待 web 全功能联调覆盖。
- **Chrome WebHID 端到端**：`webhid/index.html`（本地 http 服务）真机通过。授权列表出现两个条目：接口1（0x000C:0x0001 + 0x0001:0x0002 + 0xFFFF:0x0001，Feature 写报 NotAllowedError——该集合无 Feature 定义，系统拒绝属正常）和接口2（0xFFFF:0x0002）。接口2 `sendFeatureReport(0, 80…7f)` + `receiveFeatureReport(0)` 返回 `80 08 01…`，wIndex=2 全链路可用；键盘接口0被 Chromium 键盘 blocklist 封锁，不出现在授权列表。
- Web 版连接 filter 应直接写 `{vendorId:0x3151, usagePage:0xFFFF, usage:0x0002}` 指向接口2厂商 Feature 集合。Chrome 对同源已授权设备有记忆，`navigator.hid.getDevices()` 可免再次弹框。仅 Chromium 系浏览器支持 WebHID，页面需 localhost 或 HTTPS。ZCode 内置浏览器（Electron/Chromium 146）也有 `navigator.hid`。
- **Chrome 连接层卡死（2026-10-28 实测定性）**：多次页面重载/并发后 `sendFeatureReport` 报 NotAllowedError，**键盘本身健康**——同时刻原生 IOKit 控制传输秒回（`tools/windex_probe.c`）。恢复办法：`device.forget()` 释放授权后走一次全新 `requestDevice` 周期（web 版连接按钮已内置此逻辑）。
- **软件关灯语义（2026-10-28 真机修正）**：厂商前端 LightOff 走 07 帧 `mode=0, brightness=0`；06 的 bit4 门控位是键盘硬件快捷键的独立开关，软件开关灯**不应触碰**（此前用 06 关灯真机无效）。
- **并发约束**：多个操作交错读写同一 EP0 功能寄存器会产生陈旧应答；多标签页同时打开页面也会争用。Web 版已用页内串行队列 + Web Locks('m1w-usb') 跨标签互斥解决。
- 工程化 Web 版使用 Svelte 5、TypeScript 和 vitest；当前支持单按与 Fn 组合分层编辑，以及宏录制。

## 11. 蓝牙 WebHID 通路（2026-10-30 验证）

- M1W RGB BT1 在 macOS 上为 `3151:4013`，厂商集合为 `FF55:0202`，通过 Report ID `06` 的 Output / Input 传输；数据部分是 `55` 加原有的 64 字节协议帧。校验仍对 64 字节命令帧计算，不含 `55`。
- 输入报告异步到达，可能早于发送操作完成；客户端在发送前监听并缓存匹配应答，过滤非配置报告。有些整块应答没有命令回显，因此保留版本查询栅栏。
- 在 Chrome 中读取到设备 ID 983、固件 1.08、配置 0、完整基础层和 Fn 层以及灯效状态；基础层 F12→F11→F12 和 Fn+F11 的音量减→F12→音量减均经过写入和读回，原值已恢复。
- 首次设备 ID 查询偶发超时，仅在尚未发送任何配置写入时自动重试一次该只读握手；配置写入不自动重发。蓝牙灯效、宏的写入以及物理触发尚未逐项验证。
