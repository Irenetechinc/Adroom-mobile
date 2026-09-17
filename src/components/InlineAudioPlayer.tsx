import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function InlineAudioPlayer({ uri }: { uri: string }) {
  const safeUri = escapeHtml(uri);
  return (
    <View style={styles.container}>
      <WebView
        originWhitelist={['*']}
        source={{ html: `<!doctype html><html><body><audio controls preload="metadata" src="${safeUri}"></audio></body></html>` }}
        style={styles.webview}
        javaScriptEnabled={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 48, marginTop: 10, overflow: 'hidden', borderRadius: 8, backgroundColor: '#0B0F19' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
