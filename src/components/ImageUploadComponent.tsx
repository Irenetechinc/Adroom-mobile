import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, FlatList, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Upload, X } from 'lucide-react-native';

interface ImageUploadComponentProps {
  onImagesSelected: (images: { uri: string; base64: string | null }[]) => void;
  initialImages?: { uri: string; base64: string | null }[];
  maxImages?: number;
}

const ImageUploadComponent: React.FC<ImageUploadComponentProps> = ({
  onImagesSelected,
  initialImages = [],
  maxImages = 5,
}) => {
  const [selectedImages, setSelectedImages] = useState<{ uri: string; base64: string | null }[]>(initialImages);
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    if (selectedImages.length >= maxImages) {
      Alert.alert('Image Limit Reached', `You can only upload a maximum of ${maxImages} images.`);
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access camera roll is required!');
      return;
    }

    setUploading(true);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    });
    setUploading(false);

    if (!result.canceled && result.assets) {
      const newImages = result.assets.map(asset => ({
        uri: asset.uri,
        base64: asset.base64 || null,
      }));
      
      const updatedImages = [...selectedImages, ...newImages].slice(0, maxImages);
      setSelectedImages(updatedImages);
      onImagesSelected(updatedImages);
    }
  };

  const removeImage = (uriToRemove: string) => {
    const updatedImages = selectedImages.filter(image => image.uri !== uriToRemove);
    setSelectedImages(updatedImages);
    onImagesSelected(updatedImages);
  };

  return (
    <View className="mt-4">
      <Text className="text-white font-bold text-base mb-2">Upload Images ({selectedImages.length}/{maxImages})</Text>
      
      <TouchableOpacity
        onPress={pickImage}
        className="bg-adroom-dark p-4 rounded-lg border border-adroom-neon/30 flex-row items-center justify-center mb-3"
        disabled={uploading || selectedImages.length >= maxImages}
      >
        {uploading ? (
          <ActivityIndicator color="#00F0FF" />
        ) : (
          <>
            <Upload size={20} color="#00F0FF" />
            <Text className="text-adroom-neon font-medium ml-2">
              {selectedImages.length > 0 ? 'Add More Images' : 'Select Images'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {selectedImages.length > 0 && (
        <FlatList
          data={selectedImages}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.uri}
          renderItem={({ item }) => (
            <View className="relative mr-3 mb-3">
              <Image source={{ uri: item.uri }} className="w-24 h-24 rounded-lg border border-adroom-neon/20" />
              <TouchableOpacity
                onPress={() => removeImage(item.uri)}
                className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1"
              >
                <X size={16} color="white" />
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
};

export default ImageUploadComponent;
