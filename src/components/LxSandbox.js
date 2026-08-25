// LX 音源 WebView 沙箱组件
// 隐藏的 WebView, 用于执行 jsjiami 混淆音源脚本
// 必须渲染在 App 树中 (但不显示)
import React, { useRef, useEffect } from 'react';
import { WebView } from 'react-native-webview';
import { SANDBOX_HTML } from '../services/lx-webview-sandbox';
import {
  setWebViewRef,
  handleWebViewMessage,
  isSandboxReady,
} from '../services/lx-webview-manager';

export default function LxSandbox() {
  const webViewRef = useRef(null);

  useEffect(() => {
    setWebViewRef(webViewRef.current);
    return () => {
      setWebViewRef(null);
    };
  }, []);

  return (
    <WebView
      ref={webViewRef}
      source={{ html: SANDBOX_HTML }}
      style={{
        width: 1,
        height: 1,
        opacity: 0,
      }}
      containerStyle={{
        width: 0,
        height: 0,
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: 0,
        flex: 0,
      }}
      onMessage={handleWebViewMessage}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      originWhitelist={['*']}
      allowFileAccess={true}
      allowUniversalAccessFromFileURLs={true}
      mixedContentMode="always"
      // 禁用 WebView 的滚动和交互
      scrollEnabled={false}
      pointerEvents="none"
      // 允许 HTTPS/HTTP 请求
      allowsInlineMediaPlayback={true}
      mediaPlaybackRequiresUserAction={false}
      // WebView 调试 (开发时打开)
      webviewDebuggingEnabled={__DEV__}
    />
  );
}
