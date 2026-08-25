import { useColorScheme } from 'react-native';
import { lightColors, darkColors } from './colors';
import { usePlayerStore } from '../store/useStore';

/**
 * 主题 hook：根据 themeMode 返回对应色板
 * - 'light'  → 始终浅色
 * - 'dark'   → 始终深色
 * - 'auto'   → 跟随系统
 */
export function useTheme() {
  const scheme = useColorScheme();
  const themeMode = usePlayerStore(s => s.themeMode) || 'auto';

  const isDark = themeMode === 'dark' || (themeMode === 'auto' && scheme === 'dark');
  const colors = isDark ? darkColors : lightColors;

  return { colors, isDark, scheme };
}
