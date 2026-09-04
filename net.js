/* ============================================================
 * net.js · 联机层（Trystero P2P，免服务器，靠房间号互相发现）
 *
 * 注意：本文件是【经典脚本】。不能用 <script type="module">——
 * 用户通常以 file:// 直接打开页面，浏览器会拦截本地 ES Module。
 * 这里用动态 import() 从 CDN 加载 Trystero（CDN 带 CORS 头，
 * file:// 页面同样可用），加载成功后写入 window.wwNet。
 * 加载需要联网；失败时仅禁用联机，单机不受影响。
 * ============================================================ */
import('https://esm.run/trystero')
  .then((m) => {
    window.wwNet = { joinRoom: m.joinRoom, selfId: m.selfId };
  })
  .catch((err) => {
    console.warn('联机模块加载失败（仅联机不可用，单机正常）', err);
  });
