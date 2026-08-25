// 全屏播放页 — 对应桌面端播放控制 + 歌词面板
import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Dimensions, Share, NativeModules, TextInput
} from 'react-native';
import Slider from '@react-native-community/slider';
import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import {
  PlayIcon, PauseIcon, PrevIcon, NextIcon, HeartIcon,
  ShuffleIcon, RepeatIcon, RepeatOneIcon, ChevronDownIcon,
  VolumeOnIcon, VolumeMuteIcon, ListIcon, MoreIcon, DownloadIcon,
  ClockIcon, ShareIcon, FolderIcon
} from './icons';
import { usePlayerStore } from '../store/useStore';
import { isFavorited as checkFavorited, toggleFavorite as toggleFav, loadSettings } from '../core/storage';
import { formatTime } from '../utils/format';
import { musicSongUrl } from '../core/source-manager';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_SIZE = Math.min(SCREEN_WIDTH * 0.5, SCREEN_HEIGHT * 0.28);

export default function FullPlayer({ visible, onClose, onQueuePress }) {
  const { colors } = useTheme();

  const store = usePlayerStore();
  const lyricsScrollRef = useRef(null);
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);
  const {
    playlist, currentIndex, isPlaying, playMode, isRoaming,
    roamIndex, roamPlaylist, favorites, lyricsData, currentLyricIndex,
    position, duration, volume, isMuted
  } = store;

  const {
    togglePlay, playPrevious, playNext, cyclePlayMode,
    seekTo, setVolume, toggleMute, setFavorites, setToast
  } = store;

  const scrollY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(scrollY, { toValue: 0, useNativeDriver: true, tension: 40, friction: 8 }).start();
    } else {
      Animated.timing(scrollY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible]);

  const LYRIC_LINE_HEIGHT = 32;
  const LYRIC_TRANSLATION_HEIGHT = 20;

  useEffect(() => {
    if (lyricsData.length > 0 && currentLyricIndex >= 0 && lyricsScrollRef.current) {
      let yOffset = 0;
      for (let i = 0; i < currentLyricIndex; i++) {
        yOffset += LYRIC_LINE_HEIGHT;
        if (lyricsData[i] && lyricsData[i].translation) {
          yOffset += LYRIC_TRANSLATION_HEIGHT;
        }
      }
      yOffset = Math.max(0, yOffset - scrollAreaHeight / 3);
      lyricsScrollRef.current.scrollTo({ y: yOffset, animated: true });
    }
  }, [currentLyricIndex, scrollAreaHeight, lyricsData]);

  let track = null;
  if (isRoaming && roamIndex >= 0 && roamIndex < roamPlaylist.length) {
    track = { ...roamPlaylist[roamIndex], type: 'online', songId: roamPlaylist[roamIndex].id };
  } else if (currentIndex >= 0 && currentIndex < playlist.length) {
    track = playlist[currentIndex];
  }

  // === 右上角菜单 hooks（必须在 if (!track) return null 之前） ===
  const [menuVisible, setMenuVisible] = useState(false);
  const [sleepTimer, setSleepTimer] = useState(null);
  const [sleepCountdown, setSleepCountdown] = useState('');
  const [sleepPickerVisible, setSleepPickerVisible] = useState(false);
  const [customSleepInput, setCustomSleepInput] = useState('');
  const [qualityPickerVisible, setQualityPickerVisible] = useState(false);

  // 菜单弹出动画
  const menuAnim = useRef(new Animated.Value(0)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;

  const showMenuWithAnim = () => {
    setMenuVisible(true);
    Animated.parallel([
      Animated.spring(menuAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 8 }),
      Animated.timing(menuOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };
  const hideMenuWithAnim = () => {
    Animated.parallel([
      Animated.timing(menuAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(menuOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => setMenuVisible(false));
  };

  useEffect(() => {
    if (!sleepTimer) {
      setSleepCountdown('');
      return;
    }
    const updateCountdown = () => {
      const remaining = sleepTimer.endTime - Date.now();
      if (remaining <= 0) {
        if (usePlayerStore.getState().isPlaying) {
          usePlayerStore.getState().togglePlay();
        }
        setSleepTimer(null);
        setSleepCountdown('');
        setToast('定时关闭已生效');
        return;
      }
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setSleepCountdown(min + ':' + String(sec).padStart(2, '0'));
    };
    updateCountdown();
    const intervalId = setInterval(updateCountdown, 1000);
    return () => clearInterval(intervalId);
  }, [sleepTimer]);

  if (!track) return null;

  const fav = checkFavorited(track, favorites);
  const posSec = position / 1000;
  const durSec = duration / 1000;

  const handleFav = () => {
    const newFavs = toggleFav(track, [...favorites]);
    setFavorites(newFavs);
    setToast(fav ? '已从我喜欢移除' : '已加入我喜欢');
  };

  const handleSeek = (value) => {
    seekTo(value * 1000);
  };

  const handleVolume = (value) => {
    setVolume(value);
  };

  const handleDownload = async () => {
    hideMenuWithAnim();
    if (!track) return;
    setToast('正在获取下载链接...');
    try {
      const songId = track.songId || track.id;
      if (!songId) { setToast('无法获取歌曲ID'); return; }
      const store = usePlayerStore.getState();
      const source = track._src || track._platform || store.currentSource || 'netease';
      const platform = track._platform || (source.startsWith('lx:') ? 'netease' : source);
      const settings = await loadSettings();
      const playSource = settings.playSource || 'official';
      const urlData = await musicSongUrl(playSource, { ...track, songId, _platform: platform }, track);
      if (!urlData || !urlData.url) { setToast('无法获取下载链接'); return; }
      setToast('正在下载到 Download/NeonPlayer...');
      const fileName = (track.name || 'unknown') + ' - ' + (track.artist || '') + '.mp3';
      await NativeModules.UpdaterModule.downloadToMusicDir(urlData.url, fileName);
      setToast('「' + track.name + '」已下载到 Download/NeonPlayer');
    } catch (e) {
      setToast('下载失败: ' + (e.message || ''));
    }
  };

  const handleOpenDownloadDir = async () => {
    hideMenuWithAnim();
    try {
      await NativeModules.UpdaterModule.openDownloadFolder();
    } catch (e) {
      setToast('无法打开文件管理器: ' + (e.message || ''));
    }
  };

  const handleSleepTimer = () => {
    hideMenuWithAnim();
    if (sleepTimer) {
      setSleepTimer(null);
      setSleepCountdown('');
      setToast('已取消定时关闭');
      return;
    }
    setSleepPickerVisible(true);
  };

  const setSleepTime = (minutes) => {
    setSleepPickerVisible(false);
    setCustomSleepInput('');
    if (minutes <= 0) return;
    const endTime = Date.now() + minutes * 60 * 1000;
    setSleepTimer({ endTime });
    setToast('将在 ' + minutes + ' 分钟后停止播放');
  };

  const handleShare = async () => {
    hideMenuWithAnim();
    if (!track) return;
    try {
      const songId = track.songId || track.id;
      let shareUrl = '';
      if (songId) {
        const source = track._src || track._platform || usePlayerStore.getState().currentSource || 'netease';
        const platform = track._platform || (source.startsWith('lx:') ? 'netease' : source);
        const settings = await loadSettings();
        const playSource = settings.playSource || 'official';
        const urlData = await musicSongUrl(playSource, { ...track, songId, _platform: platform }, track);
        if (urlData && urlData.url) shareUrl = urlData.url;
      }
      const versionName = require('../../app.json').version || '1.00.009';
      const downloadUrl = 'https://gitee.com/tang-shupeng/neon-release/releases/download/' + versionName + '/neon-player-' + versionName + '.apk';
      const message =
        '\uD83C\uDFB5 ' + track.name + (track.artist ? ' - ' + track.artist : '') + '\n\n' +
        (shareUrl ? '在线试听: ' + shareUrl + '\n\n' : '') +
        '下载 Neon Player 音乐播放器: ' + downloadUrl;
      await Share.share({ message, url: shareUrl || undefined });
    } catch (e) {
      setToast('分享失败: ' + (e.message || ''));
    }
  };

  let ModeIcon = playMode === 'shuffle' ? ShuffleIcon : playMode === 'repeat-one' ? RepeatOneIcon : RepeatIcon;

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.bgPrimary, transform: [{ translateY: scrollY }] }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
          <ChevronDownIcon width={24} height={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {track.name}
        </Text>
        <TouchableOpacity style={styles.headerBtn} onPress={showMenuWithAnim}>
          {sleepTimer ? (
            <View style={styles.sleepBadge}>
              <ClockIcon width={14} height={14} color={colors.accent} />
              <Text style={[styles.sleepText, { color: colors.accent }]}>{sleepCountdown}</Text>
            </View>
          ) : (
            <MoreIcon width={24} height={24} color={colors.textPrimary} />
          )}
        </TouchableOpacity>
      </View>

      {/* 右上角弹出菜单 */}
      {menuVisible && (
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={hideMenuWithAnim}>
          <Animated.View style={[
            styles.menuPanel,
            { backgroundColor: colors.bgSecondary },
            {
              opacity: menuOpacity,
              transform: [{ scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            },
          ]}>
            <TouchableOpacity style={styles.menuItem} onPress={handleDownload}>
              <DownloadIcon width={20} height={20} color={colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>下载</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleOpenDownloadDir}>
              <FolderIcon width={20} height={20} color={colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>打开下载目录</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleSleepTimer}>
              <ClockIcon width={20} height={20} color={sleepTimer ? colors.accent : colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: sleepTimer ? colors.accent : colors.textPrimary }]}>
                {sleepTimer ? '取消定时关闭' : '定时关闭'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { hideMenuWithAnim(); setTimeout(() => setQualityPickerVisible(true), 160); }}>
              <MoreIcon width={20} height={20} color={colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>音质选择</Text>
              <Text style={[styles.menuItemValue, { color: colors.textMuted }]}>{({low:'低',standard:'标准',high:'高',lossless:'无损'})[usePlayerStore.getState().musicQuality] || '标准'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleShare}>
              <ShareIcon width={20} height={20} color={colors.textPrimary} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>分享</Text>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      )}

      {/* 定时关闭时间选择 */}
      {sleepPickerVisible && (
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setSleepPickerVisible(false)}>
          <View style={[styles.sleepPickerPanel, { backgroundColor: colors.bgSecondary }]}>
            <Text style={[styles.sleepPickerTitle, { color: colors.textPrimary }]}>选择定时关闭时间</Text>
            {[15, 30, 45, 60].map(m => (
              <TouchableOpacity key={m} style={styles.sleepOptionBtn} onPress={() => setSleepTime(m)}>
                <Text style={[styles.sleepOptionText, { color: colors.textPrimary }]}>{m} 分钟</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.customInputRow}>
              <TextInput
                style={[styles.customInput, { color: colors.textPrimary, borderColor: colors.border }]}
                placeholder="自定义分钟数"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={customSleepInput}
                onChangeText={setCustomSleepInput}
              />
              <TouchableOpacity
                style={[styles.customConfirmBtn, { backgroundColor: colors.accent }]}
                onPress={() => setSleepTime(parseInt(customSleepInput, 10) || 0)}
              >
                <Text style={styles.customConfirmText}>确认</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.sleepCancelBtn} onPress={() => { setSleepPickerVisible(false); setCustomSleepInput(''); }}>
              <Text style={[styles.sleepOptionText, { color: colors.textMuted }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* 音质选择 */}
      {qualityPickerVisible && (
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setQualityPickerVisible(false)}>
          <View style={[styles.sleepPickerPanel, { backgroundColor: colors.bgSecondary }]}>
            <Text style={[styles.sleepPickerTitle, { color: colors.textPrimary }]}>选择音质</Text>
            {[
              { value: 'low', label: '低音质 (128kbps)' },
              { value: 'standard', label: '标准 (320kbps)' },
              { value: 'high', label: '高品质 (320kbps+)' },
              { value: 'lossless', label: '无损 (FLAC)' },
            ].map(opt => {
              const currentQ = usePlayerStore.getState().musicQuality || 'standard';
              return (
                <TouchableOpacity key={opt.value} style={styles.sleepOptionBtn} onPress={() => {
                  usePlayerStore.getState().setMusicQuality(opt.value);
                  setQualityPickerVisible(false);
                  setToast('音质已切换为' + opt.label);
                }}>
                  <Text style={[styles.sleepOptionText, { color: currentQ === opt.value ? colors.accent : colors.textPrimary }]}>
                    {opt.label}{currentQ === opt.value ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.sleepCancelBtn} onPress={() => setQualityPickerVisible(false)}>
              <Text style={[styles.sleepOptionText, { color: colors.textMuted }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* Cover */}
      <View style={styles.coverArea}>
        <View style={[styles.cover, { backgroundColor: colors.bgTertiary }]}>
          <Text style={{ fontSize: 48 }}>🎵</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoArea}>
        <View style={styles.infoRow}>
          <Text style={[styles.songName, { color: colors.textPrimary }]} numberOfLines={1}>
            {track.name}
          </Text>
          <TouchableOpacity style={styles.favBtn} onPress={handleFav}>
            <HeartIcon filled={fav} width={24} height={24} color={fav ? colors.accent : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.artist, { color: colors.textMuted }]} numberOfLines={1}>
          {track.artist || (track.type === 'online' ? '在线音乐' : '本地音乐')}
        </Text>
      </View>

      {/* Lyrics */}
      <View style={styles.lyricsArea}>
        {lyricsData.length > 0 ? (
          <ScrollView
            ref={lyricsScrollRef}
            style={styles.lyricsScroll}
            contentContainerStyle={styles.lyricsContent}
            onLayout={(e) => setScrollAreaHeight(e.nativeEvent.layout.height)}
          >
            {lyricsData.map((line, i) => (
              <View key={i}>
                <Text style={[
                  styles.lyricLine,
                  { color: i === currentLyricIndex ? colors.accent : colors.textMuted },
                  i === currentLyricIndex && styles.lyricActive
                ]}>
                  {line.text}
                </Text>
                {line.translation ? (
                  <Text style={[styles.lyricTranslation, { color: colors.textMuted }]}>
                    {line.translation}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.noLyricsPlaceholder}>
            <Text style={[styles.noLyricsText, { color: colors.textMuted }]}>
              暂无歌词
            </Text>
          </View>
        )}
      </View>

      {/* Progress */}
      <View style={styles.progressArea}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={durSec > 0 ? durSec : 1}
          value={posSec}
          onSlidingComplete={handleSeek}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
        />
        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: colors.textMuted }]}>{formatTime(posSec)}</Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>{formatTime(durSec)}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={cyclePlayMode}>
          <ModeIcon width={22} height={22} color={playMode !== 'sequence' ? colors.accent : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={playPrevious}>
          <PrevIcon width={28} height={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.playBtn, { backgroundColor: colors.accent }]} onPress={togglePlay}>
          {isPlaying ? (
            <PauseIcon width={32} height={32} color="#fff" />
          ) : (
            <PlayIcon width={32} height={32} color="#fff" />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => playNext(true)}>
          <NextIcon width={28} height={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={onQueuePress}>
          <ListIcon width={22} height={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Volume */}
      <View style={styles.volumeRow}>
        <TouchableOpacity onPress={toggleMute}>
          {isMuted || volume === 0 ? (
            <VolumeMuteIcon width={18} height={18} color={colors.textMuted} />
          ) : (
            <VolumeOnIcon width={18} height={18} color={colors.textMuted} />
          )}
        </TouchableOpacity>
        <Slider
          style={styles.volumeSlider}
          minimumValue={0}
          maximumValue={1}
          value={isMuted ? 0 : volume}
          onSlidingComplete={handleVolume}
          minimumTrackTintColor={colors.textSecondary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: HEADER_PADDING_TOP,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  headerBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    textAlign: 'center',
  },
  sleepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sleepText: {
    fontSize: 12,
    fontWeight: '600',
  },
  menuOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  menuPanel: {
    position: 'absolute',
    top: HEADER_PADDING_TOP + 48,
    right: 24,
    borderRadius: 12,
    padding: 8,
    minWidth: 180,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemText: {
    fontSize: 15,
  },
  menuItemValue: {
    fontSize: 13,
    marginLeft: 'auto',
  },
  sleepPickerPanel: {
    position: 'absolute',
    top: HEADER_PADDING_TOP + 48,
    right: 24,
    borderRadius: 16,
    padding: 20,
    minWidth: 220,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  sleepPickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  sleepOptionBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  sleepOptionText: {
    fontSize: 15,
  },
  sleepCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  customConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  customConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  coverArea: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  infoArea: {
    paddingHorizontal: 28,
    paddingBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  songName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  favBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  artist: {
    fontSize: 13,
    marginTop: 2,
  },
  lyricsArea: {
    flex: 1,
    paddingHorizontal: 28,
    minHeight: 60,
  },
  lyricsScroll: {
    flex: 1,
  },
  lyricsContent: {
    paddingVertical: 10,
  },
  lyricLine: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 32,
  },
  lyricActive: {
    fontSize: 17,
    fontWeight: '700',
  },
  lyricTranslation: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.7,
  },
  noLyricsPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noLyricsText: {
    fontSize: 14,
  },
  progressArea: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  slider: {
    width: '100%', height: 40,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 11,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  ctrlBtn: {
    width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtn: {
    width: 64, height: 64,
    borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 36,
    gap: 12,
  },
  volumeSlider: {
    flex: 1, height: 30,
  },
});
