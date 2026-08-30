import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, Image, Dimensions, Linking, BackHandler } from 'react-native';
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
import * as FileSystem from 'expo-file-system/legacy';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { neteaseToplist, neteaseToplistDetail, neteaseShuffleSongs, neteaseSearch, musicSongUrl } from '../core/source-manager';
import { isFavorited, toggleFavorite } from '../core/storage';
import { downloadAndCache } from '../core/cache-manager';
import TrackItem from '../components/TrackItem';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ContextMenu from '../components/ContextMenu';
import { TrophyIcon, FlameIcon, CompassIcon, ChevronLeftIcon } from '../components/icons';

const SUB_TABS = [
  { id: 'toplist', label: '排行榜', icon: TrophyIcon },
  { id: 'hot', label: '热歌榜', icon: FlameIcon },
  { id: 'roam', label: '漫游', icon: CompassIcon },
];

export default function DiscoverScreen() {
  const { colors } = useTheme();

  const [loading, setLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [menuIndex, setMenuIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const {
    toplistData, setToplistData,
    toplistDetailData: toplistDetail, setToplistDetailData,
    hotData, setHotData,
    discoverSubTab: subTab, setDiscoverSubTab: setSubTab,
    setQueue, playOnlineSong, favorites, setFavorites, setToast,
    isRoaming, roamIndex, roamPlaylist, startRoam, stopRoam,
  } = usePlayerStore();

  const setToplistDetail = (detail) => setToplistDetailData(detail);

  // 监听 Android 返回键：在排行榜详情中按返回键，直接回到排行榜一级页面
  useEffect(() => {
    if (!toplistDetail) return;
    const onBackPress = () => {
      setToplistDetail(null);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [toplistDetail]);

  // Load toplist on mount (only first time when empty)
  useEffect(() => {
    if (subTab === 'toplist' && toplistData.length === 0 && !loading) {
      loadToplists();
    }
  }, [subTab]);

  // Load hot songs when switching to hot tab (only first time when empty)
  useEffect(() => {
    if (subTab === 'hot' && hotData.length === 0 && !loading) {
      loadHot();
    }
  }, [subTab]);

  const loadToplists = async () => {
    setLoading(true);
    const data = await neteaseToplist();
    setToplistData(data);
    setLoading(false);
  };

  const loadToplistDetail = async (item) => {
    setLoading(true);
    const songs = await neteaseToplistDetail(item.id);
    const detail = { name: item.name, songs };
    setToplistDetail(detail);
    setLoading(false);
  };

  const loadHot = async () => {
    setLoading(true);
    // 热歌榜 = 飙升榜 + 网友热度榜 的前30首
    try {
      const songs = await neteaseToplistDetail(3779629);
      const sliced = songs.slice(0, 30);
      setHotData(sliced);
      usePlayerStore.getState().setHotData(sliced);
    } catch (e) {
      setToast('加载热歌榜失败');
    }
    setLoading(false);
  };

  const handlePlaySong = (song, index, sourceArr) => {
    const arr = sourceArr.map(s => ({ ...s, type: 'online', songId: s.id }));
    setQueue(subTab, arr, index);
    playOnlineSong(song, index);
  };

  const handleFav = (song) => {
    const track = { ...song, type: 'online', songId: song.id };
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast(isFavorited(track, favorites) ? '已从我喜欢移除' : '已加入我喜欢');
  };

  const handleDownload = async (song) => {
    if (!song) { setMenuVisible(false); return; }
    setToast('正在获取下载链接...');
    try {
      const songId = song.id || song.songId;
      if (!songId) { setToast('无法获取歌曲ID'); setMenuVisible(false); return; }
      const source = usePlayerStore.getState().currentSource || 'netease';
      const urlData = await musicSongUrl(source, songId, song);
      if (!urlData || !urlData.url) {
        setToast('无法获取下载链接');
        setMenuVisible(false);
        return;
      }
      setToast('正在下载到 Download/NeonPlayer...');
      const { NativeModules } = require('react-native');
      const fileName = `${song.name || 'unknown'} - ${song.artist || ''}.mp3`.trim();
      await NativeModules.UpdaterModule.downloadToMusicDir(urlData.url, fileName);
      setToast(`「${song.name}」已下载到 Download/NeonPlayer`);
    } catch (e) {
      setToast('下载失败: ' + (e.message || ''));
    }
    setMenuVisible(false);
  };

  const handlePlayNext = (song, index) => {
    const track = { ...song, type: 'online', songId: song.id };
    const { playlist, currentIndex } = usePlayerStore.getState();
    const newPlaylist = [...playlist];
    const insertAt = currentIndex + 1;
    if (!newPlaylist.some(t => t.songId === song.id)) {
      newPlaylist.splice(insertAt, 0, track);
      usePlayerStore.setState({ playlist: newPlaylist });
      setToast('已添加到下一首播放');
    } else {
      setToast('该歌曲已在播放列表中');
    }
    setMenuVisible(false);
  };

  const handleOpenDownloadDir = async () => {
    try {
      const { NativeModules } = require('react-native');
      await NativeModules.UpdaterModule.openDownloadFolder();
    } catch (e) {
      setToast('无法打开文件管理器: ' + (e.message || ''));
    }
    setMenuVisible(false);
  };

  const handleLongPress = (song, index, x, y) => {
    setMenuTrack(song);
    setMenuIndex(index);
    setMenuPos({ x, y });
    setMenuVisible(true);
  };

  // === Toplist Grid View ===
  const renderToplistGrid = () => {
    if (loading) return <Spinner text="加载排行榜..." />;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
        <View style={[styles.grid, { backgroundColor: colors.bgPrimary }]}>
          {toplistData.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.toplistCard, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
              onPress={() => loadToplistDetail(item)}
            >
              {item.coverImgUrl ? (
                <Image source={{ uri: item.coverImgUrl }} style={styles.toplistCover} />
              ) : (
                <View style={[styles.toplistCover, { backgroundColor: colors.bgTertiary }]} />
              )}
              <Text style={[styles.toplistName, { color: colors.textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.toplistUpdate, { color: colors.textMuted }]} numberOfLines={1}>
                {item.updateFrequency || ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  };

  // === Toplist Detail View ===
  const renderToplistDetail = () => {
    if (loading) return <Spinner text="加载中..." />;
    const { name, songs } = toplistDetail;
    return (
      <View style={{ flex: 1 }}>
        <View style={[styles.detailHeader, { borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => setToplistDetail(null)}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.6}
          >
            <ChevronLeftIcon width={22} height={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.detailTitle, { color: colors.textPrimary }]}>{name}</Text>
        </View>
        <FlatList
          data={songs}
          renderItem={({ item, index }) => {
            const fav = isFavorited({ ...item, type: 'online', songId: item.id }, favorites);
            const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : String(index + 1);
            return (
              <TrackItem
                index={index}
                name={item.name}
                artist={item.artist}
                duration={item.duration}
                fee={item.fee}
                isOnline
                rankIcon={rankIcon}
                isFavorited={fav}
                onPress={() => handlePlaySong(item, index, songs)}
                onFavPress={() => handleFav(item)}
                onLongPress={(e) => {
                  const { pageX, pageY } = e.nativeEvent;
                  handleLongPress(item, index, pageX, pageY);
                }}
              />
            );
          }}
          keyExtractor={(item, index) => `${item.id}_${index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      </View>
    );
  };

  // === Hot View ===
  const renderHot = () => {
    if (loading) return <Spinner text="加载热歌榜..." />;
    if (hotData.length === 0) return <EmptyState icon="🔥" title="暂无热歌数据" />;
    return (
      <FlatList
        data={hotData}
        renderItem={({ item, index }) => {
          const fav = isFavorited({ ...item, type: 'online', songId: item.id }, favorites);
          const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : String(index + 1);
          return (
            <TrackItem
              index={index}
              name={item.name}
              artist={item.artist}
              duration={item.duration}
              fee={item.fee}
              isOnline
              rankIcon={rankIcon}
              isFavorited={fav}
              onPress={() => handlePlaySong(item, index, hotData)}
              onFavPress={() => handleFav(item)}
              onLongPress={(e) => {
                const { pageX, pageY } = e.nativeEvent;
                handleLongPress(item, index, pageX, pageY);
              }}
            />
          );
        }}
        keyExtractor={(item, index) => `${item.id}_${index}`}
        contentContainerStyle={{ paddingBottom: 80 }}
      />
    );
  };

  // === Roam View ===
  const renderRoam = () => {
    if (isRoaming) {
      return (
        <View style={{ flex: 1 }}>
          <View style={[styles.roamHeader, { borderColor: colors.border }]}>
            <Text style={[styles.roamTitle, { color: colors.textPrimary }]}>
              漫游播放中 ({roamPlaylist.length}首)
            </Text>
            <TouchableOpacity onPress={stopRoam} style={[styles.stopBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.stopBtnText}>停止漫游</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={roamPlaylist}
            renderItem={({ item, index }) => {
              const fav = isFavorited({ ...item, type: 'online', songId: item.id }, favorites);
              const isCurrent = index === roamIndex;
              return (
                <TrackItem
                  index={index}
                  name={item.name}
                  artist={item.artist}
                  duration={item.duration}
                  fee={item.fee}
                  isOnline
                  isPlaying={isCurrent}
                  isFavorited={fav}
                  onPress={() => usePlayerStore.getState().playRoamSong(index)}
                  onFavPress={() => handleFav(item)}
                  onLongPress={(e) => {
                    const { pageX, pageY } = e.nativeEvent;
                    handleLongPress(item, index, pageX, pageY);
                  }}
                />
              );
            }}
            keyExtractor={(item, index) => `${item.id}_${index}`}
            contentContainerStyle={{ paddingBottom: 80 }}
          />
        </View>
      );
    }
    return (
      <View style={styles.roamHero}>
        <CompassIcon width={80} height={80} color={colors.accent} />
        <Text style={[styles.roamHeroTitle, { color: colors.textPrimary }]}>随机漫游</Text>
        <Text style={[styles.roamHeroHint, { color: colors.textMuted }]}>
          从多个榜单随机抽取歌曲，发现新音乐
        </Text>
        <TouchableOpacity
          style={[styles.roamStartBtn, { backgroundColor: colors.accent }]}
          onPress={startRoam}
        >
          <Text style={styles.roamStartBtnText}>开始漫游</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.resetPrefBtn, { borderColor: colors.border }]}
          onPress={async () => {
            const { resetRoamPrefs } = await import('../core/player-engine');
            await resetRoamPrefs();
          }}
        >
          <Text style={[styles.resetPrefText, { color: colors.textMuted }]}>重置偏好</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>发现音乐</Text>
      </View>
      {/* Sub tabs */}
      <View style={[styles.subTabRow, { borderColor: colors.border }]}>
        {SUB_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.subTab,
                subTab === tab.id && { borderBottomColor: colors.accent, borderBottomWidth: 2 }
              ]}
              onPress={() => setSubTab(tab.id)}
            >
              <Icon width={16} height={16} color={subTab === tab.id ? colors.accent : colors.textMuted} />
              <Text style={{
                color: subTab === tab.id ? colors.accent : colors.textMuted,
                fontSize: 13,
                marginLeft: 4,
              }}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {subTab === 'toplist' && (toplistDetail ? renderToplistDetail() : renderToplistGrid())}
      {subTab === 'hot' && renderHot()}
      {subTab === 'roam' && renderRoam()}

      <ContextMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={menuTrack ? `${menuTrack.name} - ${menuTrack.artist || ''}` : ''}
        x={menuPos.x}
        y={menuPos.y}
        actions={[
          { label: '📑 添加到歌单', onPress: () => usePlayerStore.getState().openAddToPlaylist(menuTrack) },
          { label: '⬇ 下载', onPress: () => handleDownload(menuTrack) },
          { label: '▶ 下一首播放', onPress: () => handlePlayNext(menuTrack, menuIndex) },
          { label: '📂 打开下载路径', onPress: () => handleOpenDownloadDir() },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: HEADER_PADDING_TOP, paddingBottom: 4 },
  title: { fontSize: 22, fontWeight: '700' },
  subTabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  subTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 8,
  },
  toplistCard: {
    width: (SCREEN_W - 40) / 3,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
  },
  toplistCover: {
    width: '100%',
    height: 70,
    resizeMode: 'cover',
  },
  toplistName: {
    fontSize: 12,
    fontWeight: '600',
    padding: 6,
    paddingBottom: 1,
  },
  toplistUpdate: {
    fontSize: 10,
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  detailTitle: { fontSize: 16, fontWeight: '700', marginLeft: 4 },
  roamHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 60,
  },
  roamHeroTitle: { fontSize: 24, fontWeight: '700' },
  roamHeroHint: { fontSize: 14 },
  resetPrefBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  resetPrefText: {
    fontSize: 13,
  },
  roamStartBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 12,
  },
  roamStartBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  roamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  roamTitle: { fontSize: 14 },
  stopBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stopBtnText: { color: '#fff', fontSize: 13 },
});
