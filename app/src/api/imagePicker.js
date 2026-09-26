// Cross-platform image picker.
//  - Web: uses a native <input type="file"> and returns a real File (reliable).
//  - Native: uses expo-image-picker and returns its asset.
// Returns null if the user cancels.
import { Platform } from 'react-native';

export async function pickImage() {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.onchange = () => {
        const file = input.files && input.files[0];
        resolve(file ? { file } : null);
      };
      // If the dialog is dismissed, onchange may not fire; that's fine (no upload).
      input.click();
    });
  }

  // Native
  const ImagePicker = require('expo-image-picker');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permission to access photos is required.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (result.canceled) return null;
  return { asset: result.assets[0] };
}
