import { defineConfig } from "vite";

// Tauri 개발용 설정: 포트를 고정하고(tauri.conf.json의 devUrl과 같은 값),
// Rust 쪽(src-tauri) 변경은 Vite가 감시하지 않게 한다.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
