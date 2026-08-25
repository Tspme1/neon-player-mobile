// 预处理 jsjiami.com.v7 混淆代码 — 移除反调试死循环和解密循环
// jsjiami 使用两种 while(!![]) 模式:
// 1. 反调试陷阱: while(!![]){}  — 空死循环
// 2. 解密循环: while(!![]&&--counter) — 依赖 counter 退出, Hermes 中可能死循环

export function patchAntiDebug(code) {
  let patched = code;
  let patchCount = 0;

  // 模式1: while(!![]){} — 空死循环体 (反调试陷阱)
  patched = patched.replace(/while\s*\(\s*!\s*!\s*\[\s*\]\s*\)\s*\{\s*\}/g, () => {
    patchCount++;
    return 'while(false){}';
  });

  // 模式2: while(!![]&&expr) — jsjiami 解密循环
  // 替换 !![] 为 true, 使条件变为 while(true&&expr) = while(expr)
  // 这样循环仍由 expr (如 --counter) 控制, 能正常退出
  patched = patched.replace(/while\s*\(\s*!\s*!\s*\[\s*\]\s*&&/g, () => {
    patchCount++;
    return 'while(';
  });

  // 模式3: while(expr&&!![]) — 反向形式
  patched = patched.replace(/&&\s*!\s*!\s*\[\s*\]\s*\)/g, () => {
    patchCount++;
    return ')';
  });

  // 模式4: while(!![]) — 纯死循环条件 (无 &&)
  patched = patched.replace(/while\s*\(\s*!\s*!\s*\[\s*\]\s*\)/g, () => {
    patchCount++;
    return 'while(false)';
  });

  // 模式5: while(true){} — 通用空死循环
  patched = patched.replace(/while\s*\(\s*true\s*\)\s*\{\s*\}/g, () => {
    patchCount++;
    return 'while(false){}';
  });

  // 模式6: for(;;){} — 无限 for 循环
  patched = patched.replace(/for\s*\(\s*;\s*;\s*\)\s*\{\s*\}/g, () => {
    patchCount++;
    return 'while(false){}';
  });

  if (patchCount > 0) {
    console.log(`[LX] Patched ${patchCount} anti-debug pattern(s)`);
  }

  return patched;
}
