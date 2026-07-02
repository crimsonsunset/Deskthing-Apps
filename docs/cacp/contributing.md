# Contributing to CACP

**How to Add Support for New Music Sites**

**Updated:** July 28, 2025  
**Current Status:** Foundation development phase

---

## 🎯 **Overview**

Adding support for a new music streaming site involves creating a **site handler** that implements the CACP interface. This guide walks you through the process using the current development structure.

## 🏗️ **Development Setup**

### **Repository Structure**
```
DeskThing-Apps/
├── cacp-extension/         # 🎯 New universal Chrome extension
│   ├── sites/             # Your site handler goes here
│   ├── managers/          # Core system (don't modify)
│   └── settings/          # Settings UI (for priority)
├── cacp-app/              # 🎯 Universal DeskThing app
├── soundcloud-extension/  # ✅ Reference implementation
└── soundcloud-app/        # ✅ Working baseline
```

### **Development Workflow**
```bash
npm run install:all        # Install all dependencies (includes cacp-extension)
npm run start              # Interactive emulator/desktop picker
# or: npm run start:emulator

# Load cacp-extension/dist/ in Chrome Developer Mode (once)
# Test with your target streaming site
```

See [local-development.md](./local-development.md) for ports, startup sequence, and troubleshooting.

## 🚀 **Quick Start**

1. **Study reference** - Examine `soundcloud-extension/` for working patterns
2. **Copy template** - Use `cacp-extension/sites/_template.js` as starting point
3. **Implement handler** - Create your site-specific handler
4. **Test thoroughly** - Verify functionality across different scenarios
5. **Submit PR** - Follow contribution guidelines

## 📋 **Site Handler Requirements**

### **Minimum Implementation**
Your site handler must extend the base handler and provide:

```javascript
// cacp-extension/sites/yoursite.js
import { SiteHandler } from './base-handler.js';

export class YourSiteHandler extends SiteHandler {
  static config = {
    name: 'Your Site Name',
    urlPatterns: ['yoursite.com', 'music.yoursite.com'],
    selectors: {
      playButton: '.play-btn',
      pauseButton: '.pause-btn',
      nextButton: '.next-btn',
      prevButton: '.prev-btn',
      title: '.track-title',
      artist: '.artist-name'
    }
  };
  
  // Optional: Override for complex behavior
  getTrackInfo() {
    // Custom extraction logic if needed
    return super.getTrackInfo(); // Use config defaults
  }
}
```

## 🔧 **Implementation Approaches**

### **Level 1: Config-Only (Recommended Start)**
Perfect for sites with stable, simple DOM structures:

```javascript
export class SimpleHandler extends SiteHandler {
  static config = {
    name: 'Simple Site',
    urlPatterns: ['simple.com'],
    selectors: {
      playButton: '.play',
      title: '.song-title',
      artist: '.artist'
      // Base handler does the rest automatically
    }
  }
  // No custom methods needed!
}
```

### **Level 2: Selective Overrides (Most Common)**
Override specific methods for complex edge cases:

```javascript
export class CustomHandler extends SiteHandler {
  static config = { /* basic selectors */ };
  
  // Custom logic for play state detection
  getTrackInfo() {
    if (this.isPodcastMode()) {
      return this.extractPodcastInfo();
    }
    return super.getTrackInfo(); // Use config defaults
  }
  
  // Override if site has unusual play/pause behavior
  play() {
    if (this.isInSpecialMode()) {
      // Custom play logic
    } else {
      super.play(); // Use config defaults
    }
  }
}
```

### **Level 3: Full Custom (Complex Sites)**
For sites requiring extensive custom logic:

```javascript
export class AdvancedHandler extends SiteHandler {
  static config = { /* basic info only */ };
  
  // Completely custom implementations
  play() { /* site-specific logic */ }
  getTrackInfo() { /* complex extraction */ }
  getCurrentTime() { /* custom progress tracking */ }
}
```

## 🧪 **Testing Guidelines**

### **Manual Testing Checklist**
Test your handler across these scenarios:

- [ ] **Basic playback** - Play, pause, next, previous
- [ ] **Metadata extraction** - Title, artist, album, artwork
- [ ] **Progress tracking** - Current time, duration updates
- [ ] **Edge cases** - Site not loaded, user not logged in
- [ ] **State transitions** - Song changes, playlist navigation
- [ ] **Error scenarios** - Network issues, DOM changes

### **Testing Environment**
```bash
# Development setup
npm run dev:cacp

# Load cacp-extension/ in Chrome Developer Mode
# Navigate to your target site
# Open extension popup for real-time debugging
```

## 📝 **Required Documentation**

When submitting your site handler, include:

1. **Handler file** - `cacp-extension/sites/yoursite.js`
2. **Manifest update** - Add your site to `cacp-extension/manifest.json` host permissions
3. **Testing notes** - Document what scenarios you tested
4. **Known limitations** - Any edge cases or missing features
5. **Screenshots** - Show the integration working

## 📋 **Submission Process**

### **Pull Request Requirements**
- [ ] Handler implements required interface methods
- [ ] Manifest includes necessary host permissions
- [ ] Code follows existing style patterns
- [ ] Testing completed across edge cases
- [ ] Documentation provided

### **Review Process**
1. **Automated checks** - Code style, manifest validation
2. **Manual testing** - Maintainer verification
3. **Integration** - Added to supported sites list
4. **Documentation** - Updated contributor guides

## ❓ **Common Questions**

### **Q: What if the site changes its DOM structure?**
A: Use multiple fallback selectors or implement custom detection logic.

### **Q: How do I handle sites with authentication?**
A: Implement `isLoggedIn()` method and gracefully handle auth states.

### **Q: What about sites with ads or interruptions?**
A: Handle ad states in your custom logic, pause metadata during ads.

### **Q: Can I support mobile versions of sites?**
A: Yes, add mobile URL patterns and handle responsive differences.

## 🤝 **Getting Help**

- **Template:** Start with `cacp-extension/sites/_template.js`
- **Reference:** Study `soundcloud-extension/` for working patterns
- **Documentation:** See `docs/cacp/api-reference.md` for interface details
- **Issues:** Open GitHub issue for technical questions

---

**Current Development Phase:** Foundation implementation  
**Next Phase:** Multi-site core with contributor pipeline  
**Target:** Easy community contributions for 10+ streaming sites
