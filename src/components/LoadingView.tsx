import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export function LoadingView() {
  return (
    <View style={styles.container} testID="loading-view">
      <ActivityIndicator size="large" color="#4A90E2" accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9F9F9',
  },
});
