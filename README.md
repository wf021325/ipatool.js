# 代码参考来源
https://github.com/beerpiss/ipatool.ts

## 功能

- 购买、下载ipa功能，没有查询版本号
- 下载【已经下架的新旧版APP】前提是自己曾经下载过
- 可处理大于 4G 的安装包

### 用法
- 测试环境：`windows10` `Node` `v20` / `V22` / `V24`
- 把`.env.example`改名为`.env` 里面配置 账号 密码 软件id 等
- 模块安装：`npm i` / `pmpm i`

```bash 
# 安装项目依赖
npm i
```

- 运行以下命令(win/mac/linux)
```bash 
node main.js
```