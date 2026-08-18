# Accessibility

## Commitment

Stay Close must be usable by non-technical users and older family members. Accessibility is not an afterthought — it is a first-class requirement of the product. Every screen, every interaction, and every notification is reviewed for accessibility during development.

---

## Standards

Stay Close targets compliance with:

- **WCAG 2.1 Level AA** — Web Content Accessibility Guidelines (applied to mobile)
- **Apple Human Interface Guidelines** — Accessibility section
- **Android Accessibility Guidelines**

---

## Screen Reader Support

The app must be fully navigable with:

- **iOS**: VoiceOver
- **Android**: TalkBack

Requirements:

- Every interactive element must have an accessible label
- Labels are provided via `accessibilityLabel` on React Native components
- Labels describe the element's purpose — not its appearance
- Screen reader focus order must be logical (top-to-bottom, left-to-right within each screen)
- Dynamic content changes (new suggestion, error message) must be announced with `accessibilityLiveRegion`

### Examples

```tsx
// Good
<TouchableOpacity accessibilityLabel="Mark reminder as done">
  <Text>Done</Text>
</TouchableOpacity>

// Bad — screen reader would say "Done" but this is ambiguous without context
<TouchableOpacity>
  <Text>Done</Text>
</TouchableOpacity>

// Good — icon-only button with label
<TouchableOpacity accessibilityLabel="Open settings">
  <Icon name="settings" />
</TouchableOpacity>
```

---

## Tap Targets

Minimum interactive tap target size: **44 × 44 points** (Apple guideline) / **48 × 48dp** (Android guideline).

Small icons and labels must have their hitSlop expanded or be contained in a larger touchable area.

```tsx
// Expand tap target without changing visual size
<TouchableOpacity
  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
  onPress={...}
>
  <SmallIcon />
</TouchableOpacity>
```

---

## Dynamic Type / Font Scaling

The app must respect the user's font size preferences set at the OS level.

- Never set explicit pixel font sizes that ignore system font scale
- Use `fontSize` values from a consistent type scale
- Test at:
  - Default font size
  - Large font size (system accessibility setting)
  - Extra-large font size (system accessibility setting)
- Layouts must not break or clip text at large font sizes
- Scrollable containers must be used where content may expand significantly

---

## Color and Contrast

Colour must never be the only means of conveying information.

Example:
- A selected contact must show a checkmark or other visual indicator, not just a colour change
- An error state must show an error message text, not just red colouring

**Minimum contrast ratios (WCAG AA)**:
- Normal text: 4.5:1
- Large text (18pt+ or 14pt bold+): 3:1
- UI components and graphics: 3:1

The functional build uses a high-contrast black/white palette by default. Colour choices made during the production UI phase must be validated against these ratios.

---

## Focus and Navigation

- All interactive elements must be reachable via keyboard (hardware keyboard, switch access, external input)
- Focus must not be trapped on any screen
- Modal dialogs and bottom sheets must trap focus within themselves until dismissed
- Confirmation dialogs (e.g. "Delete All My Data?") must be fully accessible

---

## Destructive Actions

Destructive actions (delete circle, delete all data) must:

- Require explicit confirmation — never execute on a single tap
- Present the confirmation in a modal that is accessible to screen readers
- Have clearly labeled confirm and cancel buttons
- Default focus to the Cancel button to prevent accidental destruction

---

## Accessible Error Messages

Error states must communicate:

1. What went wrong
2. What the user can do about it

Error messages are read aloud by screen readers. They must be complete sentences and not assume the user can see the visual context.

Bad:
```
Error.
```

Good:
```
Circle name cannot be empty. Please enter a name for your circle.
```

---

## Notification Accessibility

Notification content must be meaningful when read aloud by screen reader or notification summary:

- Private mode: "You have someone to reconnect with." — clear and standalone
- Detailed mode: "Maybe reach out to Alex today." — clear and standalone

---

## Onboarding Accessibility

The onboarding flow is often where new users first encounter the app. It must be:

- Fully navigable by screen reader
- Never blocked by an inaccessible element
- Free of animations that cannot be disabled (respect "Reduce Motion" settings)

---

## Reduce Motion

Animations must respect the OS "Reduce Motion" setting:

```typescript
import { AccessibilityInfo } from 'react-native';

const prefersReducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
```

When reduce motion is enabled:
- Transition animations are removed or simplified
- No looping animations are played

---

## Accessibility Testing

### Automated

React Native Testing Library provides:

- `getByRole()` — verify elements have correct roles
- `getByLabelText()` — verify accessible labels exist
- `toHaveAccessibilityState()` — verify states like `selected`, `disabled`

Every component test must verify accessible labels for interactive elements.

### Manual — VoiceOver (iOS)

1. Settings → Accessibility → VoiceOver → On
2. Navigate through every screen
3. Verify every element is announced correctly
4. Verify focus order is logical
5. Verify dynamic content changes are announced

### Manual — TalkBack (Android)

1. Settings → Accessibility → TalkBack → On
2. Navigate through every screen
3. Verify every element is announced correctly
4. Verify swipe navigation works correctly

### Manual — Large Text

1. Settings → Accessibility → Display & Text Size → Larger Text → Maximum
2. Open every screen
3. Verify no text is clipped
4. Verify layout does not break

---

## Accessibility Checklist (Per PR)

For any PR that adds or modifies a screen or component:

- [ ] Every interactive element has an `accessibilityLabel`
- [ ] Labels describe purpose, not appearance
- [ ] Tap targets meet minimum size requirements
- [ ] Focus order is logical
- [ ] Error messages are screen-reader-friendly
- [ ] Destructive actions require confirmation
- [ ] Colour is not the sole indicator of state
- [ ] Reduce Motion is respected if animations are added
- [ ] Dynamic content announcements added where needed
- [ ] Component tests verify accessible labels

---

## Known Limitations

- Automated testing cannot fully verify VoiceOver / TalkBack behaviour — manual QA is always required
- Font scaling behaviour is verified by QA checklist but not automated
- Complex gesture interactions (long press, drag) may require additional VoiceOver / TalkBack testing beyond standard swipe navigation
