// Token persistence that works on web (localStorage) and native (AsyncStorage).
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aeps.accessToken';
const THEME_KEY = 'aeps.theme';

export async function saveToken(token) {
  try { await AsyncStorage.setItem(KEY, token); } catch {}
}
export async function getToken() {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}
export async function clearToken() {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

// Theme cache (so the saved theme applies instantly on next load).
export async function getThemeCache() {
  try { const v = await AsyncStorage.getItem(THEME_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function setThemeCache(theme) {
  try { await AsyncStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch {}
}
