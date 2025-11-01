# 🎵 yt-dlp Helper for SoundCloud & Bandcamp

Simple and convenient solution for downloading music from SoundCloud and Bandcamp directly from your browser using `yt-dlp`. Integration via Tampermonkey and PowerShell provides a smooth user experience without the need to manually copy links and configure commands.

## ✨ Key Features

### 🎯 Smart Browser Integration
- **Automatic download button addition** on SoundCloud and Bandcamp pages
- Works with tracks, albums, playlists, and artist pages
- Native UI that seamlessly fits into site design

### 🎨 Flexible Download Configuration
- **Quality selection** (best quality, MP3 or M4A)
- **Custom yt-dlp parameters** for advanced settings
- **Save path configuration** with last choice memory
- **Smart file organization**:
  - Artist/uploader folder
  - Album folder (for Bandcamp)
  - Track numbering (for albums)
- **Path preview** before download

### ⚡ Automation via yt-dlp
- Uses proven `yt-dlp` tool
- Configurable metadata options (thumbnail, metadata, overwrite protection)
- Download progress display
- Simple protocol installation via script parameters

## 🚀 Quick Start

### Requirements
- [Tampermonkey](https://www.tampermonkey.net/) (for Chrome/Edge/Firefox)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed in system
- PowerShell (built into Windows 10/11)

### Installation

1. **Install Tampermonkey** in your browser via the official extension store:
   - [Chrome/Edge](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - [Opera](https://addons.opera.com/extensions/details/tampermonkey/)

2. **Install the script**:
   
   [![Install ytdl-scbc.user.js](https://img.shields.io/badge/Install-Tampermonkey%20Script-brightgreen?style=for-the-badge)](https://raw.githubusercontent.com/Sharaj00/ytdl-scbc/main/ytdl-scbc.user.js)
   
   **Or manually:**
   - Open Tampermonkey → Create a new script
   - Copy contents of `ytdl-scbc.user.js`
   - Save (Ctrl+S)

3. **Configure `ytdl://` protocol handler**:
   - Copy `ytdl-scbc.ps1` to a convenient location (e.g., `C:\Scripts\`)
   - Register the protocol in Windows:
     ```powershell
     # Run PowerShell as Administrator
     .\ytdl-scbc.ps1 -install
     ```
   - To unregister the protocol:
     ```powershell
     .\ytdl-scbc.ps1 -uninstall
     ```

4. **Check yt-dlp availability**:
   ```powershell
   yt-dlp --version
   ```
   If command not found, install yt-dlp according to [official instructions](https://github.com/yt-dlp/yt-dlp#installation)

## 📖 Usage

1. Open a track, album, or artist page on SoundCloud or Bandcamp
2. Click the **"yt-dl Download"** button (SoundCloud) or **"Download"** button (Bandcamp):
   - On track/album pages: button is in the actions menu (three dots) or purchase section
   - On artist pages: button appears in profile header
3. In the opened dialog:
   - Select quality (best/m4a/mp3)
   - Optionally add your yt-dlp parameters (e.g., `--extract-flat --flat-playlist`)
   - Specify save path
   - Check desired file organization and metadata options
   - Preview the save path example
4. Click **"Confirm"**
5. Download will start automatically in the background

## 🎛️ Settings

### Download Templates
By default available:
- `best` - best available quality
- `m4a` - download in M4A format
- `mp3` - convert to MP3

### Custom Parameters
In a separate field you can specify your yt-dlp parameters for advanced configuration. For example:
- `--extract-flat --flat-playlist` - to get track list without downloading
- `--playlist-start 1 --playlist-end 10` - to download a specific range of tracks
- `--write-info-json` - to save metadata in JSON file

### File Organization
- **Artist folder**: `C:\Downloads\ArtistName\TrackName.mp3`
- **Album folder** (Bandcamp): `C:\Downloads\ArtistName\AlbumName\TrackName.mp3`
- **Track numbering** (albums): `C:\Downloads\ArtistName\AlbumName\1. TrackName.mp3`

### Metadata
The download dialog provides the following metadata options:
- **Embed thumbnail** - embed cover art in file (enabled by default)
- **Add metadata** - add metadata (artist, title, album, etc.) (enabled by default)
- **No overwrites** - protection against overwriting existing files (enabled by default)

### Using Cookies from Browser
The **Use cookies from browser** option allows using cookies from your browser for platform authorization. This is useful for accessing private tracks or tracks requiring authorization.

- Script exports cookies from current domain (SoundCloud or Bandcamp) to Netscape HTTP Cookie File format
- Cookies are transmitted via `ytdl://` protocol as base64-encoded data
- PowerShell script creates a temporary cookies file and passes it to yt-dlp via `--cookies` parameter
- Temporary file is automatically deleted after download completion
- Option is enabled by default to ensure access to protected content

## 🔧 Technical Details

### Architecture
- **Tampermonkey script**: injects UI into SoundCloud/Bandcamp pages, collects track metadata, generates `ytdl://` URL
- **PowerShell handler**: parses `ytdl://` protocol, extracts parameters, runs `yt-dlp` with required options

### ytdl:// Protocol
Format: `ytdl:?url=<encoded_url>&template=<template>&output=<output_path>&custom=<custom_params>&embedThumbnail=<true|false>&addMetadata=<true|false>&noOverwrites=<true|false>&cookiesData=<base64_encoded_cookies>`

Example:
```
ytdl:?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack&template=-f%20ba%5Bext%3Dmp3%5D&output=C%3A%5CDownloads%5C%25(uploader)s%5C%25(title)s.%25(ext)s&embedThumbnail=true&addMetadata=true&noOverwrites=true&cookiesData=<base64_data>
```

### yt-dlp Parameters
By default used:
- `--quiet` - silent mode (without extra output)
- `--progress` - show progress
- `--console-title` - update console title
- `--newline` - proper newline output

Additional parameters passed via dialog:
- `--embed-thumbnail` - if "Embed thumbnail" option is enabled
- `--add-metadata` - if "Add metadata" option is enabled
- `--no-overwrites` - if "No overwrites" option is enabled
- `--cookies <file>` - if "Use cookies from browser" option is enabled (cookies are exported from browser and saved to temporary file)
- Custom parameters from "Custom yt-dlp parameters" field

### Compatibility
- **Browsers**: Chrome, Edge, Firefox (with Tampermonkey)
- **OS**: Windows 10/11 (PowerShell built-in)
- **yt-dlp**: latest versions

## 📝 Version
Current version: **1.0**

## 👤 Author
sharaj

## 📄 License
Project is provided "as is" for personal use.

---

**Note**: Use this tool responsibly and comply with SoundCloud and Bandcamp terms of use, as well as copyrights of rights holders.
