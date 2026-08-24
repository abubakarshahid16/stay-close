/**
 * Placeholder home screen.
 *
 * The functional screens (today's reminders, groups, reminder detail) arrive
 * with the use cases that back them, in M2 onwards. This exists so the router
 * has a valid entry point and the project builds.
 *
 * Phase A: utilitarian by design (docs/PRODUCT.md §6, §37).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        Stay Close
      </Text>
      <Text style={styles.body}>
        Functional V1 foundation. Groups, schedules and reminders are not wired up yet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  heading: { fontSize: 20, marginBottom: 12 },
  body: { fontSize: 14 },
});
