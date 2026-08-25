// 搜索框组件
import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { SearchIcon } from './icons';

export default function SearchBar({ value, onChangeText, onSubmit, placeholder = '搜索歌曲、歌手...' }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.glassBg, borderColor: colors.border }]}>
      <SearchIcon width={16} height={16} color={colors.textMuted} />
      <TextInput
        style={[styles.input, { color: colors.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
      />
      <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent }]} onPress={onSubmit}>
        <Text style={styles.btnText}>搜索</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
  },
});
