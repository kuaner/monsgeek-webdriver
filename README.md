# MonsGeek Web Driver

MonsGeek M1W 的网页配置工具。通过浏览器连接键盘，无需安装原厂驱动或后台服务。

[打开网页](https://kuaner.github.io/monsgeek-webdriver/) · [协议说明](docs/protocol-notes.md)

![2.4G 连接与键盘主界面](docs/screenshots/hero.jpg)

## 支持设备

RongYuan M1W RGB，设备 ID 983：

| 连接方式 | 设备 |
| --- | --- |
| 有线 USB | `3151:4015` |
| 2.4G 接收器 | `3151:4011`，显示键盘电量 |
| 蓝牙 | `3151:4013` |

需要支持 WebHID 的 Chrome 或 Edge。固件 1.04 支持基础层配置，固件 1.08 同时支持 Fn 层配置。

HFD M1W VIA（`3555:3670`）是另一款硬件，请使用 [VIA](https://usevia.app/)。

## 功能

- SVG 键盘布局，Mac / Windows 键帽随键盘模式切换。
- 单按改键、组合键，以及独立的 Fn 层设置。
- 宏录制、事件与延时编辑、播放方式设置。
- 旋钮逆时针、按下和顺时针三个独立动作。
- 灯效、亮度、速度、彩虹和自定义颜色。
- 手动保存、切换、导入、导出配置及恢复默认。
- 写入后读回校验，失败时恢复原值。

![Fn 组合与改键](docs/screenshots/remap.jpg)

![灯效设置](docs/screenshots/lighting.jpg)

## 使用

1. 打开网页，点击 USB、2.4G 或蓝牙。
2. 在浏览器设备列表中选择键盘或接收器并授权。
3. 点击按键、旋钮或「灯效」进行设置。
4. 配置管理、导入导出和恢复默认位于「更多」菜单。

2.4G 模式需要插入接收器，并将键盘切换到 2.4G。键盘休眠后，先按键唤醒再操作。

网页可以安装为 PWA。设备授权和手动保存的配置仅属于当前网址，不会上传。

## 固件

M1W 设备 983 的原厂 1.08 固件和 macOS 升级工具见[固件说明](firmware/m1w-983/README.md)。

## 开发

```sh
npm ci
npm run dev       # http://127.0.0.1:8765
npm run check     # Svelte / TypeScript 检查
npm test
npm run build
```

推送 `v*` 标签会运行检查、部署 GitHub Pages 并创建 Release。
