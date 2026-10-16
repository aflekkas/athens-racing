Same Riviera start position, camera, requested afternoon conditions, fixed 66° FOV. Maximum before/after camera-component difference: 0. Counts are the main scene draw, after resetting renderer.info; mirror/post/UI passes are excluded. SwiftShader: no GPU/FPS claim. More draws are the deliberate cost of restoring the owner-required cabin; windscreen rain itself remains one draw and now uses two triangles.

| Vehicle / weather | Main-scene draw calls before → after | Main-scene triangles before → after |
|---|---:|---:|
| aygo / dry | 183 → 195 | 668984 → 669056 |
| qashqai / dry | 185 → 208 | 669136 → 669412 |
| dolphin / dry | 181 → 204 | 668696 → 668972 |
| atto3 / dry | 181 → 204 | 668696 → 668972 |
| van / dry | 176 → 198 | 668056 → 668320 |
| truck / dry | 178 → 200 | 668120 → 668384 |
| bus / dry | 177 → 199 | 639720 → 639984 |
| delivery / dry | 186 → 192 | 669196 → 669268 |
| scooter / dry | 186 → 192 | 669196 → 669268 |
| moto / dry | 186 → 192 | 669196 → 669268 |
| police_octavia / dry | 191 → 216 | 669358 → 669606 |
| police_moto / dry | 186 → 192 | 669196 → 669268 |
| panda / dry | 187 → 213 | 668918 → 669178 |
| jazz / dry | 188 → 215 | 668934 → 669206 |
| yaris / dry | 191 → 217 | 669358 → 669618 |
| ibiza / dry | 192 → 218 | 669366 → 669626 |
| golf / dry | 191 → 216 | 669358 → 669606 |
| mini / dry | 192 → 217 | 669382 → 669630 |
| gr_yaris / dry | 191 → 216 | 669358 → 669606 |
| gla / dry | 191 → 216 | 669358 → 669606 |
| corolla / dry | 191 → 217 | 669358 → 669618 |
| taxi / dry | 192 → 217 | 669372 → 669620 |
| superb / dry | 191 → 217 | 669358 → 669618 |
| cla / dry | 191 → 216 | 669358 → 669606 |
| cle / dry | 191 → 216 | 669358 → 669606 |
| z4 / dry | 192 → 216 | 669382 → 669618 |
| carrera / dry | 192 → 217 | 669414 → 669662 |
| carrera / rain | 194 → 219 | 673022 → 673264 |
| aventador_svj / dry | 186 → 208 | 668870 → 669082 |
| aventador_svj / rain | 188 → 210 | 672478 → 672684 |
| huracan / dry | 185 → 210 | 668438 → 668686 |
| gtv / dry | 192 → 218 | 669446 → 669706 |
| e36 / dry | 192 → 218 | 669446 → 669706 |
| mini_jcw / dry | 192 → 218 | 669382 → 669642 |
