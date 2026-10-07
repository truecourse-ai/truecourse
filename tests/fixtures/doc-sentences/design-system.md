---
version: alpha
name: Reactive Resume
description: A monochrome, content-first design system for a free and open-source resume builder. Dark-by-default with light mode support.
colors:
  primary: "#343434"
  primary-foreground: "#FBFBFB"
  secondary: "#F7F7F7"
  secondary-foreground: "#343434"
  background: "#FFFFFF"
  foreground: "#252525"
  muted: "#F7F7F7"
  muted-foreground: "#8E8E8E"
  border: "#EBEBEB"
  ring: "#B5B5B5"
  destructive: "#DC2626"
  on-destructive: "#FFFFFF"
rounded:
  sm: 0.18rem
  md: 0.24rem
  lg: 0.3rem
  xl: 0.42rem
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: 36px
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: 36px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    height: 36px
  button-ghost:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: 36px
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-destructive}"
    rounded: "{rounded.lg}"
    height: 36px
---

# Design System

Reactive Resume is monochrome by default. Color is reserved for state.

## Buttons

Six variants, all sharing `rounded-lg` corners and a 1px `translate-y` on active press.

| Variant | Use |
| --- | --- |
| `default` | The primary action of a view. |
| `destructive` | Deleting a resume or an account. |

## Dashboard

The sidebar contains: logo, resume list link, agent link, settings subnavigation, and a footer with user avatar.

## Color

The destructive color is red. Every other color is a shade of gray.

- Primary is near black.
- Muted text is mid gray.
- Borders are light gray.
