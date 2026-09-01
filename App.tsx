import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="default" />
      <View style={styles.content}>
        <Text style={styles.title}>Stay Close</Text>
        <Text style={styles.body}>Offline relationship reminders will be built here.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  body: {
    marginTop: 12,
    textAlign: 'center',
  },
});
