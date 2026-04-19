import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video, X, Film } from 'lucide-react-native';

export interface VideoAsset {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  duration: number | null;
}

interface VideoUploadComponentProps {
  onVideoSelected: (video: VideoAsset | null) => void;
  selectedVideo?: VideoAsset | null;
  disabled?: boolean;
}

const VideoUploadComponent: React.FC<VideoUploadComponentProps> = ({
  onVideoSelected,
  selectedVideo,
  disabled = false,
}) => {
  const [uploading, setUploading] = useState(false);

  const pickVideo = async () => {
    if (disabled) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Access to your media library is needed to upload a video.');
      return;
    }

    setUploading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.length) {
        const asset = result.assets[0];
        onVideoSelected({
          uri: asset.uri,
          fileName: asset.fileName ?? null,
          mimeType: asset.mimeType ?? null,
          fileSize: asset.fileSize ?? null,
          duration: asset.duration ?? null,
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const removeVideo = () => {
    onVideoSelected(null);
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '';
    const secs = Math.floor(ms / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (selectedVideo) {
    return (
      <View style={styles.selectedContainer}>
        <View style={styles.videoPreview}>
          <View style={styles.videoIcon}>
            <Film size={22} color="#00F0FF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.videoName} numberOfLines={1}>
              {selectedVideo.fileName || 'Video selected'}
            </Text>
            <Text style={styles.videoMeta}>
              {[formatDuration(selectedVideo.duration), formatSize(selectedVideo.fileSize)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {!disabled && (
            <TouchableOpacity onPress={removeVideo} style={styles.removeBtn}>
              <X size={14} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
        {!disabled && (
          <TouchableOpacity onPress={pickVideo} style={styles.changeBtn}>
            <Text style={styles.changeBtnText}>Change Video</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={pickVideo}
      disabled={uploading || disabled}
      style={[styles.uploadBtn, disabled && { opacity: 0.4 }]}
      activeOpacity={0.75}
    >
      {uploading ? (
        <ActivityIndicator color="#00F0FF" size="small" />
      ) : (
        <>
          <Video size={18} color="#00F0FF" />
          <Text style={styles.uploadBtnText}>Upload Promo Video</Text>
          <Text style={styles.uploadBtnSub}>MP4, MOV · optional</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,240,255,0.06)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10,
  },
  uploadBtnText: { color: '#00F0FF', fontWeight: '700', fontSize: 13, flex: 1 },
  uploadBtnSub: { color: '#475569', fontSize: 11 },
  selectedContainer: { marginBottom: 10 },
  videoPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,240,255,0.06)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 12, padding: 12,
  },
  videoIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: 'rgba(0,240,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  videoName: { color: '#E2E8F0', fontWeight: '600', fontSize: 13, marginBottom: 3 },
  videoMeta: { color: '#64748B', fontSize: 11 },
  removeBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  changeBtn: {
    marginTop: 6, alignSelf: 'flex-end',
  },
  changeBtnText: { color: '#64748B', fontSize: 12, fontWeight: '600' },
});

export default VideoUploadComponent;
