# Pix2Text MFR 1.5（镜像）

本目录是 [breezedeus/pix2text-mfr-1.5](https://huggingface.co/breezedeus/pix2text-mfr-1.5) 的原样镜像，
固定在上游提交 `1cef9f0bdcd6a4c63df7de1311fb0894593340cc`，供 Kairos「手写计算」工具在国内网络下下载模型使用。

- 原作者：BreezeDeus（[Pix2Text](https://github.com/breezedeus/Pix2Text)）
- 协议：MIT（见同目录 `LICENSE`，取自 Pix2Text 仓库；Hugging Face 模型卡标注 `license: mit`）
- 上游模型卡原文：`README.upstream.md`
- 文件未做任何修改，校验值见 `SHA256SUMS`（与 Hugging Face 上的 LFS sha256 一致）

| 文件 | 大小 |
| --- | --- |
| encoder_model.onnx | 87,510,770 B |
| decoder_model.onnx | 32,026,253 B |
| tokenizer.json | 113,168 B |
| 其余 *.json | 上游配置，工具运行时只用到上面三个 |

下载地址（带 CORS，可在浏览器 fetch）：
`https://raw.githubusercontent.com/ajie203b/personal-workstation/models/pix2text-mfr-1.5/<文件名>`
