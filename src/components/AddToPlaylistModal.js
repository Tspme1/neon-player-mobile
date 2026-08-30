// 添加到歌单弹窗组件
import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, FlatList,
  TextInput, Alert, TouchableWithoutFeedback
} from 'react-native';

import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { isFavorited, isTrackInPlaylist } from '../core/storage';
import { CloseIcon } from './icons';

export default function AddToPlaylistModal() {
  const { colors, isDark } = useTheme();
  const {
    addToPlaylistModalVisible, trackToAdd, closeAddToPlaylist,
    favorites, customPlaylists, createPlaylist, addTrackToPlaylist,
    removeTrackFromPlaylist
  } = usePlayerStore();

  const [creating, setCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  if (!addToPlaylistModalVisible || !trackToAdd) return null;

  const handleSelect = (playlistId, isAlreadyIn) => {
    if (isAlreadyIn) {
      removeTrackFromPlaylist(playlistId, trackToAdd.id || trackToAdd.songId || trackToAdd.path);
    } else {
      addTrackToPlaylist(playlistId, trackToAdd);
      closeAddToPlaylist();
    }
  };

  const handleCreateAndAdd = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      Alert.alert('提示', '请输入歌单名称');
      return;
    }
    const created = createPlaylist(trimmed);
    if (created) {
      addTrackToPlaylist(created.id, trackToAdd);
      setNewPlaylistName('');
      setCreating(false);
      closeAddToPlaylist();
    }
  };

  const isFav = isFavorited(trackToAdd, favorites);

  const playlistItems = [
    {
      id: 'favorites',
      name: '我喜欢的',
      isFavorite: true,
      count: favorites.length,
      isIn: isFav,
    },
    ...customPlaylists.map(p => ({
      id: p.id,
      name: p.name,
      isFavorite: false,
      count: p.tracks ? p.tracks.length : 0,
      isIn: isTrackInPlaylist(p, trackToAdd),
    })),
  ];

  const solidModalBg = isDark ? '#222222' : '#ffffff';
  const solidInputBg = isDark ? '#181818' : '#f5f5f5';

  return (
    <Modal
      visible={addToPlaylistModalVisible}
      transparent
      animationType="fade"
      onRequestClose={closeAddToPlaylist}
    >
      <TouchableWithoutFeedback onPress={closeAddToPlaylist}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.modalContent, { backgroundColor: solidModalBg, borderColor: colors.border }]}>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.textPrimary }]}>添加到歌单</Text>
                  <Text style={[styles.trackName, { color: colors.textSecondary }]} numberOfLines={1}>
                    {trackToAdd.name} {trackToAdd.artist ? ` - ${trackToAdd.artist}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={closeAddToPlaylist} style={styles.closeBtn}>
                  <CloseIcon width={18} height={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Create new playlist input / button */}
              {creating ? (
                <View style={[styles.createRow, { borderColor: colors.border }]}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: solidInputBg,
                        color: colors.textPrimary,
                        borderColor: colors.border
                      }
                    ]}
                    placeholder="输入新歌单名称"
                    placeholderTextColor={colors.textMuted}
                    value={newPlaylistName}
                    onChangeText={setNewPlaylistName}
                    autoFocus
                    maxLength={30}
                  />
                  <TouchableOpacity
                    style={[styles.createConfirmBtn, { backgroundColor: colors.accent }]}
                    onPress={handleCreateAndAdd}
                  >
                    <Text style={styles.createConfirmText}>创建并添加</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.createCancelBtn, { borderColor: colors.border }]}
                    onPress={() => { setCreating(false); setNewPlaylistName(''); }}
                  >
                    <Text style={[styles.createCancelText, { color: colors.textMuted }]}>取消</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.createBtn, { borderColor: colors.border }]}
                  onPress={() => setCreating(true)}
                >
                  <Text style={[styles.createBtnText, { color: colors.accent }]}>➕ 新建歌单</Text>
                </TouchableOpacity>
              )}

              {/* Playlist items */}
              <FlatList
                data={playlistItems}
                keyExtractor={item => item.id}
                style={styles.list}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.itemRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelect(item.id, item.isIn)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, { color: colors.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.itemCount, { color: colors.textMuted }]}>{item.count} 首</Text>
                    </View>
                    {item.isIn ? (
                      <View style={[styles.checkedBadge, { backgroundColor: colors.accent + '22' }]}>
                        <Text style={[styles.checkedText, { color: colors.accent }]}>已收录 ✔</Text>
                      </View>
                    ) : (
                      <Text style={[styles.addText, { color: colors.textMuted }]}>点击加入</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '75%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  trackName: {
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  createBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginVertical: 8,
  },
  createBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  input: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  createConfirmBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  createCancelBtn: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createCancelText: {
    fontSize: 13,
  },
  list: {
    marginTop: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemCount: {
    fontSize: 12,
    marginTop: 2,
  },
  checkedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  checkedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addText: {
    fontSize: 12,
  },
});