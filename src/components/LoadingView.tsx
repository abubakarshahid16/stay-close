import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export function LoadingView() {
  return (
    <View style={styles.container} testID="loading-view">
      <ActivityIndicator size="large" color="#7C3AED" accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F7F6FB',
  },
});
