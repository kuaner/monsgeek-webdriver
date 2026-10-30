# MonsGeek Web Driver

通过 WebHID 配置 MonsGeek M1W 键盘，无需安装驱动。

[打开网页](https://kuaner.github.io/monsgeek-webdriver/) · [协议笔记](docs/protocol-notes.md)

![主界面](docs/screenshots/hero.jpg)

## 支持的设备

- RongYuan（皇元）M1W RGB：有线 USB `3151:4015` 或蓝牙 `3151:4013`。
- 使用支持 WebHID 的 Chrome 或 Edge；固件 1.04 / 1.08 可配置。
- HFD M1W VIA（USB `3555:3670`）使用 [VIA](https://usevia.app/) 配置。

## 功能

- 设置单按和 Fn 组合；修改 Fn 组合时，单按功能保持不变。
- 录制宏并调整按键事件、延时和播放方式。
- 设置旋钮动作、灯效、亮度、速度和颜色。
- 手动保存、切换、导入或导出配置，也可以恢复默认设置。
- 按键和灯效写入后会读回校验；校验失败时尝试恢复原值。

![Fn 组合设置](docs/screenshots/remap.jpg)

![灯效设置](docs/screenshots/lighting.jpg)

## 使用

1. 将键盘通过数据线或蓝牙连接到电脑，打开网页并点击对应的连接方式。
2. 在设备列表中选择 MonsGeek Keyboard 或 M1W RGB BT 并授权。
3. 选择「单按」或「Fn 组合」，点击键盘图上的按键进行设置；旋钮和灯效也可以在页面中设置。

已连接时可以点击「切换连接」更换连接方式。2.4G 模式暂不支持。

网页可通过浏览器安装为 PWA，更新时会显示提示。不同网址的设备授权和本地保存的配置相互独立。

## 固件

M1W 设备 983 的原厂 1.08 固件及 macOS 升级脚本见[固件说明](firmware/m1w-983/README.md)。

## 注意事项

- 固件 1.08 的 Fn 单键写入和宏绑定已在真机上读回验证；Fn 组合的物理触发和宏播放尚未验证。固件 1.04 的 Fn 层暂时只读。
- 蓝牙已在设备 983、固件 1.08 上验证单按和 Fn 单键写入及恢复；灯效和宏的蓝牙写入尚未逐项真机验证。
- 宏录制仅支持浏览器收到的键盘事件，系统保留快捷键和 Fn 本身可能无法录制。
- 如果 macOS Chrome 的 WebHID 连接卡住，可点击「连接键盘」重新授权。建议同时只打开一个页面。

## 开发

```sh
npm ci
npm run dev       # http://127.0.0.1:8765
npm run check     # Svelte / TypeScript 检查
npm test
npm run build
```

推送 `v*` 标签会运行检查、部署 GitHub Pages 并创建 Release。
