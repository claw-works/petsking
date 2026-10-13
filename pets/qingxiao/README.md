# 清霄（gltf 皮肤）

模型与语音体积大（GLB ~41MB），不进 git（`.gitignore`：`pets/*/assets/`）。使用前同步素材：

    tools/sync-qingxiao-assets.sh [清霄仓库的 assets 目录，默认 ~/projects/tmp/qingxiao-pet/assets]

同步后目录：

    pets/qingxiao/assets/model.glb
    pets/qingxiao/assets/voices/index.json + *.mp3

- 动作：`Stand2` 待机 + `Stand1_Action01..03` 小动作（只播一遍）+ `Walk_F` / `Run_F`。
- 左右走：同一个 `Walk_F`，身体转 ±70°，平移速度按 1.011 m/s 自动换算像素。
- 语音包：加台词 = 往 `voices/` 放 mp3 + 在 `index.json` 的 `lines` 加一条（`id/text/label/expression/file`），
  然后在 `pet.json` 的 `stateActions` / `intentMap` 里用 `"voice": "<id>"` 引用。
- 需要改模型数据的地方记录在 `docs/model-change-requests.md`。
