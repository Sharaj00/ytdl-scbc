// ==UserScript==
// @name         yt-dlp helper for SoundCloud & Bandcamp (ytdl)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Download button with template selection, checkboxes and path preview for SoundCloud and Bandcamp via ytdl://
// @author       sharaj
// @match        https://soundcloud.com/*
// @match        https://*.bandcamp.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // ==================== UTILITIES AND OPTIMIZATION ====================
    
    // Debounce function for MutationObserver optimization
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Cache for processed buttons (prevents re-processing)
    const processedButtons = new WeakSet();

    // Check if button was already processed
    function isButtonProcessed(button) {
        return processedButtons.has(button);
    }

    // Mark button as processed
    function markButtonProcessed(button) {
        processedButtons.add(button);
    }

    // Save and load user settings
    function saveUserSettings(service, settings) {
        try {
            GM_setValue(`${service}_user_settings`, JSON.stringify(settings));
        } catch (error) {
            console.error('Failed to save user settings:', error);
        }
    }

    function loadUserSettings(service) {
        try {
            const settingsStr = GM_getValue(`${service}_user_settings`, null);
            if (settingsStr) {
                return JSON.parse(settingsStr);
            }
        } catch (error) {
            console.error('Failed to load user settings:', error);
        }
        return null;
    }

    // Validate save path
    function validatePath(path) {
        if (!path || typeof path !== 'string') return false;
        // Simplified check - only block truly dangerous characters
        // Allow: !, : (for C:\), spaces and other valid Windows characters
        if (/[<>"|?*\x00-\x1f]/.test(path)) return false; // Only block control characters and truly dangerous ones
        return path.length > 0;
    }

    // Validate custom yt-dlp parameters
    function validateCustomParams(params) {
        if (!params || typeof params !== 'string') return true; // Empty parameters are valid
        // Basic security checks - block input/output redirection and command execution
        const dangerousPatterns = [/[<>|]/, /&&/, /\|\|/, /`/, /\$\(/, /;\s*[a-z]/i];
        return !dangerousPatterns.some(pattern => pattern.test(params));
    }

    // Show notification to user
    function showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#d32f2f' : type === 'success' ? '#2e7d32' : '#1976d2'};
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                notification.remove();
                style.remove();
            }, 300);
        }, duration);
    }


    // ==================== MAIN FUNCTIONS ====================

    // Function to get track URL from element context
    function getTrackUrlFromContext(element, service) {
        if (service === 'soundcloud') {
            // Traverse up the DOM tree, find track container (.sound__body)
            let current = element;
            let soundBody = null;
            
            // Find .sound__body - this is the container for individual track
            for (let i = 0; i < 15 && current; i++) {
                if (current.classList && current.classList.contains('sound__body')) {
                    soundBody = current;
                    break;
                }
                current = current.parentElement;
            }
            
            if (soundBody) {
                // Find track link in title - most reliable method
                const titleLink = soundBody.querySelector('.soundTitle__title a.sc-link-primary');
                if (titleLink) {
                    const href = titleLink.getAttribute('href');
                    if (href) {
                        if (href.startsWith('http')) {
                            return href;
                        } else if (href.startsWith('/')) {
                            return 'https://soundcloud.com' + href;
                        }
                    }
                }
                
                // Alternative method - through track cover art
                const coverArtLink = soundBody.querySelector('.sound__coverArt');
                if (coverArtLink) {
                    const href = coverArtLink.getAttribute('href');
                    if (href) {
                        if (href.startsWith('http')) {
                            return href;
                        } else if (href.startsWith('/')) {
                            return 'https://soundcloud.com' + href;
                        }
                    }
                }
                
                // Try to find via data attributes
                const trackPermalink = soundBody.getAttribute('data-permalink-url') || 
                                      soundBody.getAttribute('data-permalink') ||
                                      soundBody.querySelector('[data-permalink-url]')?.getAttribute('data-permalink-url') ||
                                      soundBody.querySelector('[data-permalink]')?.getAttribute('data-permalink');
                if (trackPermalink) {
                    if (trackPermalink.startsWith('http')) {
                        return trackPermalink;
                    } else {
                        return 'https://soundcloud.com' + trackPermalink;
                    }
                }
                
                // Find any track link (not artist, not playlist)
                const anyTrackLink = soundBody.querySelector('a[href^="/"][href*="/"]:not([href*="/sets/"]):not([href*="/artists/"]):not([href*="/playlists/"])');
                if (anyTrackLink) {
                    const href = anyTrackLink.getAttribute('href');
                    if (href && href.split('/').filter(p => p).length === 2) { // Format: /artist/track
                        if (href.startsWith('/')) {
                            return 'https://soundcloud.com' + href;
                        }
                    }
                }
            }
            
            // If this is a single track page (not a list), use current URL
            const isTrackPage = document.querySelector('.soundTitle__title') !== null && 
                               document.querySelector('.sound__body') !== null;
            if (isTrackPage) {
                return window.location.href;
            }
        } else if (service === 'bandcamp') {
            // For Bandcamp, find parent track element
            let trackElement = element.closest('.track_row_view, .buyItem');
            if (!trackElement) {
                trackElement = element.closest('[data-item-id]');
            }
            
            if (trackElement) {
                // Find track link
                const trackLink = trackElement.querySelector('a[href*="/track/"], a[href*="/album/"]');
                if (trackLink) {
                    const href = trackLink.getAttribute('href');
                    if (href && href.startsWith('http')) {
                        return href;
                    } else if (href && href.startsWith('/')) {
                        return window.location.origin + href;
                    }
                }
                
                // Try to find via data attributes
                const itemId = trackElement.getAttribute('data-item-id');
                if (itemId) {
                    // If we're on an album page, construct track URL
                    const currentUrl = window.location.href;
                    if (currentUrl.includes('/album/')) {
                        return currentUrl.split('?')[0] + '?track=' + itemId;
                    }
                }
            }
        }
        
        // Default: return current URL
        return window.location.href;
    }

    // Function to add button next to "More" button in button group
    function addButtonToButtonGroup(moreButton, buttonText, buttonClass, trackUrl, buttonLabel = 'yt-dl Download') {
        try {
            // Check if button was already processed
            if (isButtonProcessed(moreButton)) return;
            
            // Check if our button is already added
            const buttonGroup = moreButton.closest('.sc-button-group');
            if (!buttonGroup) return;
            
            if (buttonGroup.querySelector(`.${buttonClass}`)) {
                markButtonProcessed(moreButton);
                return;
            }
            
            // Create button in SoundCloud style
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `${buttonClass} sc-button sc-button-secondary sc-button-medium sc-button-icon sc-button-responsive`;
            btn.style.cursor = 'pointer';
            btn.style.transition = 'opacity 0.2s';
            btn.title = buttonLabel;
            btn.setAttribute('aria-label', buttonLabel);
            
            // Structure same as standard SoundCloud buttons
            const btnInner = document.createElement('div');
            btnInner.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;"><path d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.47-7.53l1.06 1.06L8 13.06 3.47 8.53l1.06-1.06 2.72 2.72V3h1.5v7.19l2.72-2.72z" fill="currentColor"></path></svg>`;
            
            const btnLabel = document.createElement('span');
            btnLabel.className = 'sc-button-label sc-visuallyhidden';
            btnLabel.textContent = buttonLabel;
            
            btn.appendChild(btnInner);
            btn.appendChild(btnLabel);
            
            // Click handler with visual feedback
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Visual feedback - dim the button
                btn.style.opacity = '0.6';
                setTimeout(() => {
                    btn.style.opacity = '1';
                }, 200);
                
                openDialog('soundcloud', trackUrl);
            };
            
            // Insert button before "More" button
            moreButton.parentNode.insertBefore(btn, moreButton);
            markButtonProcessed(moreButton);
        } catch (error) {
            console.error('Error adding button to button group:', error);
        }
    }

    // SoundCloud page processing function (extracted for debounce)
    function processSoundCloudPages() {
        try {
            const isProfilePage = document.querySelector('.profileHeader') !== null;
            const currentUrl = window.location.href;
            
            // 1. Button for ARTIST (in .userInfoBar__buttons)
            if (isProfilePage) {
                document.querySelectorAll('.userInfoBar__buttons .sc-button-more').forEach(moreButton => {
                    if (!isButtonProcessed(moreButton)) {
                        addButtonToButtonGroup(
                            moreButton,
                            'Download artist',
                            'sc-button-download-profile',
                            currentUrl,
                            'Download artist'
                        );
                    }
                });
            }
            
            // 2. Button for TRACK on ARTIST page
            if (isProfilePage) {
                // Find More buttons in .sound__soundActions .soundActions .sc-button-more
                document.querySelectorAll('.sound__soundActions .soundActions.soundActions__medium .sc-button-more').forEach(moreButton => {
                    if (!isButtonProcessed(moreButton)) {
                        // Skip buttons in certain containers
                        if (moreButton.closest('.userInfoBar__buttons')) return; // Artist button
                        if (moreButton.closest('.trackItem__actions')) return; // Tracks inside lists
                        if (moreButton.closest('.listenEngagement__actions')) return; // Single track page
                        
                        // Find track context - traverse up to .sound__body
                        const soundBody = moreButton.closest('.sound__body');
                        
                        // Get track URL from context
                        let trackUrl = null;
                        if (soundBody) {
                            trackUrl = getTrackUrlFromContext(soundBody, 'soundcloud');
                        } else {
                            // If .sound__body not found, find parent .sound and .sound__body inside it
                            const sound = moreButton.closest('.sound');
                            if (sound) {
                                const foundSoundBody = sound.querySelector('.sound__body');
                                if (foundSoundBody) {
                                    trackUrl = getTrackUrlFromContext(foundSoundBody, 'soundcloud');
                                }
                            }
                        }
                        
                        if (trackUrl) {
                            addButtonToButtonGroup(
                                moreButton,
                                'yt-dl Download',
                                'sc-button-download-track',
                                trackUrl
                            );
                        }
                    }
                });
            }
            
            // 3. Button for single TRACK (on track page)
            if (!isProfilePage) {
                const urlMatch = currentUrl.match(/soundcloud\.com\/([^\/]+)\/([^\/?]+)/);
                const isTrackUrl = urlMatch !== null && 
                                  !currentUrl.includes('/sets/') && 
                                  !currentUrl.includes('/artists/') &&
                                  !currentUrl.match(/soundcloud\.com\/[^\/]+\/?$/);
                
                if (isTrackUrl) {
                    // Combined check for track page
                    const selectors = [
                        '.listenEngagement__actions .sc-button-more',
                        '.soundActions.listenEngagement__actions .sc-button-more'
                    ];
                    
                    selectors.forEach(selector => {
                        document.querySelectorAll(selector).forEach(moreButton => {
                            if (!isButtonProcessed(moreButton)) {
                                const buttonGroup = moreButton.closest('.sc-button-group');
                                if (buttonGroup && buttonGroup.querySelector('.sc-button-queue')) {
                                    addButtonToButtonGroup(
                                        moreButton,
                                        'yt-dl Download',
                                        'sc-button-download-single-track',
                                        currentUrl
                                    );
                                }
                            }
                        });
                    });
                }
            }
        } catch (error) {
            console.error('Error processing SoundCloud pages:', error);
        }
    }

    // SoundCloud button for tracks/albums with debounce
    const debouncedProcessSC = debounce(processSoundCloudPages, 100);
    const observerSC = new MutationObserver(debouncedProcessSC);
    observerSC.observe(document.body, { childList: true, subtree: true });
    
    // Initial processing
    processSoundCloudPages();

    // Bandcamp page processing function (extracted for debounce)
    function processBandcampPages() {
        try {
            document.querySelectorAll('.buyItem.digital .audio-quality').forEach(audioDiv => {
                if (audioDiv.parentElement.querySelector('.yt-dlp-download')) return;

                const btn = document.createElement('button');
                btn.className = 'yt-dlp-download buy-link';
                btn.textContent = 'Download';
                btn.style.textDecoration = 'underline';
                btn.style.color = '#da5 !important';
                btn.style.background = 'none';
                btn.style.border = 'none';
                btn.style.padding = '0';
                btn.style.cursor = 'pointer';
                btn.style.transition = 'opacity 0.2s';

                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Visual feedback
                    btn.style.opacity = '0.6';
                    setTimeout(() => { btn.style.opacity = '1'; }, 200);
                    const trackUrl = getTrackUrlFromContext(e.target, 'bandcamp');
                    openDialog('bandcamp', trackUrl);
                };
                audioDiv.appendChild(btn);
            });
            
            // Button for artist pages on Bandcamp
            const bandHeader = document.querySelector('#band-name-location');
            if (bandHeader && !document.querySelector('.trackTitle') && !bandHeader.querySelector('.yt-dlp-download-profile')) {
                const profileBtn = document.createElement('button');
                profileBtn.className = 'yt-dlp-download-profile buy-link';
                profileBtn.textContent = 'Download All';
                profileBtn.style.textDecoration = 'underline';
                profileBtn.style.color = '#da5 !important';
                profileBtn.style.background = 'none';
                profileBtn.style.border = 'none';
                profileBtn.style.padding = '8px 0';
                profileBtn.style.cursor = 'pointer';
                profileBtn.style.display = 'block';
                profileBtn.style.marginTop = '10px';
                profileBtn.style.transition = 'opacity 0.2s';
                profileBtn.onclick = () => {
                    profileBtn.style.opacity = '0.6';
                    setTimeout(() => { profileBtn.style.opacity = '1'; }, 200);
                    openDialog('bandcamp', window.location.href);
                };
                bandHeader.appendChild(profileBtn);
            }
        } catch (error) {
            console.error('Error processing Bandcamp pages:', error);
        }
    }

    // Bandcamp button for tracks/albums with debounce
    const debouncedProcessBC = debounce(processBandcampPages, 100);
    const observerBC = new MutationObserver(debouncedProcessBC);
    observerBC.observe(document.body, { childList: true, subtree: true });
    
    // Initial processing
    processBandcampPages();

    function detectBrowser() {
        const ua = navigator.userAgent.toLowerCase();
        
        // Detect browser from userAgent
        if (ua.includes('edg/') || ua.includes('edgios/')) {
            return 'edge';
        } else if (ua.includes('opr/') || ua.includes('opera/')) {
            return 'opera';
        } else if (ua.includes('chrome/') && !ua.includes('edg/')) {
            // Chrome or Chromium-based browsers (Brave, Vivaldi, etc.)
            if (ua.includes('brave/')) {
                return 'brave';
            } else if (ua.includes('vivaldi/')) {
                return 'vivaldi';
            }
            return 'chrome';
        } else if (ua.includes('firefox/') || ua.includes('zen/')) {
            // Firefox or Firefox-based browsers (Zen, etc.)
            return 'firefox';
        }
        
        // Default: return chrome for Chromium-based browsers
        return 'chrome';
    }

    function exportCookies() {
        // Use document.cookie to get cookies for current domain
        // For SoundCloud and Bandcamp this should cover all necessary cookies
        const cookies = document.cookie.split(';').map(c => c.trim()).filter(c => c.length > 0);
        let cookiesFile = "# Netscape HTTP Cookie File\n# This is a generated file! Do not edit.\n\n";
        
        if (cookies.length === 0) {
            console.warn('No cookies found');
            return cookiesFile;
        }
        
        // Determine base domain (remove subdomains)
        const hostname = window.location.hostname;
        let baseDomain = hostname;
        
        // For SoundCloud and Bandcamp use main domain
        if (hostname.includes('soundcloud.com')) {
            baseDomain = '.soundcloud.com';
        } else if (hostname.includes('bandcamp.com')) {
            baseDomain = '.bandcamp.com';
        } else {
            // For other domains try to determine base domain
            const parts = hostname.split('.');
            if (parts.length >= 2) {
                baseDomain = '.' + parts.slice(-2).join('.');
            } else {
                baseDomain = '.' + hostname;
            }
        }
        
        cookies.forEach(cookieStr => {
            const [name, ...valueParts] = cookieStr.split('=');
            const value = valueParts.join('=') || '';
            if (name && name.trim()) {
                const cookieName = name.trim();
                const cookieValue = value;
                const domain = baseDomain;
                const path = '/';
                // Netscape format: domain, includeSubdomains (TRUE/FALSE), path, secure (TRUE/FALSE), expiration, name, value
                // includeSubdomains: TRUE if domain starts with dot, FALSE otherwise
                const includeSubdomains = baseDomain.startsWith('.') ? 'TRUE' : 'FALSE';
                const secure = window.location.protocol === 'https:' ? 'TRUE' : 'FALSE';
                // Use future date for session cookies (1 year)
                const expires = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
                
                cookiesFile += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${cookieName}\t${cookieValue}\n`;
            }
        });
        
        return cookiesFile;
    }

    function getTrackInfo(service) {
        if (service === 'soundcloud') {
            try {
                // Check if this is a profile/artist page or a track
                const isProfilePage = document.querySelector('.profileHeader') !== null;
                
                if (isProfilePage) {
                    const artistEl = document.querySelector('.profileHeader__userName a') || document.querySelector('h1.profileHeader__userName');
                    const artistName = artistEl ? artistEl.textContent.trim() : 'artist_name';
                    return { trackName: '', artistName, albumName: '', tracks: 0, isAlbum: false, isProfile: true };
                }
                
                // Regular track
                const trackName = document.querySelector('meta[property="og:title"]')?.content?.trim() || 'track_name';
                const artistEl = document.querySelector('h2.soundTitle__username a');
                const artistName = artistEl ? artistEl.textContent.trim() : 'artist_name';
                return { trackName, artistName, albumName: '', tracks: 1, isAlbum: false, isProfile: false };
            } catch (error) {
                console.error('Error getting track info:', error);
                return { trackName: 'track_name', artistName: 'artist_name', albumName: '', tracks: 1, isAlbum: false, isProfile: false };
            }
        } else {
            // Check if this is an artist page on Bandcamp
            const isArtistPage = document.querySelector('.trackTitle') === null && document.querySelector('#band-name-location') !== null;
            
            if (isArtistPage) {
                const artistNameEl = document.querySelector('#band-name-location .title') || document.querySelector('h3 span a');
                const artistName = artistNameEl ? artistNameEl.textContent.trim() : 'artist_name';
                return { trackName: '', artistName, albumName: '', tracks: 0, isAlbum: false, isProfile: true };
            }
            
            const tracksElements = document.querySelectorAll('.track_list .track_row_view');
            const isAlbum = tracksElements.length > 1;

            const artistNameEl = document.querySelector('#band-name-location .title') || document.querySelector('h3 span a');
            const artistName = artistNameEl ? artistNameEl.textContent.trim() : 'artist_name';

            const albumNameEl = document.querySelector('h2.trackTitle');
            const albumName = albumNameEl ? albumNameEl.textContent.trim() : '';

            let trackName = '';
            if (isAlbum) {
                trackName = tracksElements[0]?.querySelector('.track-title')?.textContent?.trim() || 'first_track';
            } else {
                trackName = document.querySelector('.trackTitle')?.textContent?.trim() || 'track_name';
            }

            return { trackName, artistName, albumName, tracks: tracksElements.length || 1, isAlbum, isProfile: false };
        }
    }

    function openDialog(service, trackUrl = null) {
        try {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

            // Load saved user settings
            const savedSettings = loadUserSettings(service);
            const defaultPath = GM_getValue(service + '_last_path', 'C:\\Downloads\\');
            const lastPath = savedSettings?.path || defaultPath;
            
            const info = getTrackInfo(service);
            
            // Use provided track URL or current page URL
            const targetUrl = trackUrl || window.location.href;

            const box = document.createElement('div');
            box.style.cssText = 'background:#222;color:#fff;padding:20px;border-radius:8px;min-width:400px;max-width:600px;display:flex;flex-direction:column;gap:10px;max-height:90vh;overflow-y:auto';

            // Determine whether to show album options (Bandcamp - for albums and artist pages)
            const showAlbum = (service === 'bandcamp' && (info.isAlbum || info.isProfile));
            const showIndex = showAlbum;

            // Restore saved settings or use default values
            const defaultTemplate = savedSettings?.template || '-f b ';
            const defaultCustom = savedSettings?.custom || '';
            const defaultChkUploader = savedSettings?.chkUploader !== undefined ? savedSettings.chkUploader : true;
            const defaultChkAlbum = savedSettings?.chkAlbum !== undefined ? savedSettings.chkAlbum : true;
            const defaultChkIndex = savedSettings?.chkIndex !== undefined ? savedSettings.chkIndex : false;
            const defaultChkEmbedThumbnail = savedSettings?.chkEmbedThumbnail !== undefined ? savedSettings.chkEmbedThumbnail : true;
            const defaultChkAddMetadata = savedSettings?.chkAddMetadata !== undefined ? savedSettings.chkAddMetadata : true;
            const defaultChkNoOverwrites = savedSettings?.chkNoOverwrites !== undefined ? savedSettings.chkNoOverwrites : true;
            const defaultChkUseCookies = savedSettings?.chkUseCookies !== undefined ? savedSettings.chkUseCookies : true;

            const titleText = info.isProfile ? 'Download artist options' : 'Download options';
            
            box.innerHTML = `
                <h3 style="margin:0 0 10px 0;">${titleText}</h3>
                <label>Quality template:</label>
                <select id="template-select" style="width:100%;padding:5px;">
                    <option value='-f b ' ${defaultTemplate === '-f b ' ? 'selected' : ''}>best</option>
                    <option value='-f ba[ext=m4a]' ${defaultTemplate === '-f ba[ext=m4a]' ? 'selected' : ''}>m4a</option>
                    <option value='-f ba[ext=mp3]' ${defaultTemplate === '-f ba[ext=mp3]' ? 'selected' : ''}>mp3</option>
                </select>
                <label>Custom yt-dlp parameters (optional):</label>
                <input type="text" id="custom-params" style="width:100%;padding:5px;" placeholder="e.g. --extract-flat --flat-playlist" value="${defaultCustom}">
                <label>Save path:</label>
                <input type="text" id="path-input" style="width:100%;padding:5px;" value="${lastPath}">
                <div id="path-error" style="color:#ff6b6b;font-size:12px;display:none;"></div>
                <div>
                    <input type="checkbox" id="chk-uploader" ${defaultChkUploader ? 'checked' : ''}> ${service==='soundcloud' ? 'Uploader Folder' : 'Artist folder'}
                    <input type="checkbox" id="chk-album" ${showAlbum ? '' : 'style="display:none;"'} ${defaultChkAlbum ? 'checked' : ''}> ${showAlbum ? 'Album folder' : ''}
                    <input type="checkbox" id="chk-index" ${showIndex ? '' : 'style="display:none;"'} ${defaultChkIndex ? 'checked' : ''}> ${showIndex ? 'Track index' : ''}
                </div>
                <div style="margin-top:10px;">
                    <label>Metadata options:</label>
                    <div>
                        <input type="checkbox" id="chk-embed-thumbnail" ${defaultChkEmbedThumbnail ? 'checked' : ''}> Embed thumbnail
                    </div>
                    <div>
                        <input type="checkbox" id="chk-add-metadata" ${defaultChkAddMetadata ? 'checked' : ''}> Add metadata
                    </div>
                    <div>
                        <input type="checkbox" id="chk-no-overwrites" ${defaultChkNoOverwrites ? 'checked' : ''}> No overwrites
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <div>
                        <input type="checkbox" id="chk-use-cookies" ${defaultChkUseCookies ? 'checked' : ''}> Use cookies
                    </div>
                </div>
                <div id="example-path" style="font-size:12px;color:gray;margin-top:10px;">Example:</div>
                <button id="confirm-download" style="text-decoration:underline;color:#da5 !important;background:none;border:none;padding:8px;cursor:pointer;margin-top:10px;border:1px solid #da5;border-radius:4px;">Confirm</button>
            `;
            overlay.appendChild(box);
            document.body.appendChild(overlay);

        const pathInput = box.querySelector('#path-input');
        const chkUploader = box.querySelector('#chk-uploader');
        const chkAlbum = box.querySelector('#chk-album');
        const chkIndex = box.querySelector('#chk-index');
        const chkEmbedThumbnail = box.querySelector('#chk-embed-thumbnail');
        const chkAddMetadata = box.querySelector('#chk-add-metadata');
        const chkNoOverwrites = box.querySelector('#chk-no-overwrites');
        const chkUseCookies = box.querySelector('#chk-use-cookies');
        const customParams = box.querySelector('#custom-params');
        const exampleDiv = box.querySelector('#example-path');

        function updateExample() {
            if (!exampleDiv) return;
            try {
                let path = pathInput.value.trim() || 'C:\\Downloads\\';
                if (!path.endsWith('\\')) path += '\\';
                let parts = [];
                if (chkUploader.checked) parts.push(info.artistName || 'artist_name');
                // For artist pages show example with album folder if option is enabled
                if (chkAlbum && chkAlbum.checked && showAlbum) {
                    parts.push(info.albumName || 'album_name');
                }
                
                // For albums and artist pages (Bandcamp) show example with track index
                if ((info.isAlbum || (service === 'bandcamp' && info.isProfile)) && showAlbum) {
                    let fileName = chkIndex && chkIndex.checked && showIndex ? '1. %(title)s' : '%(title)s';
                    parts.push(fileName + '.%(ext)s');
                } else {
                    // For individual tracks
                    let fileName = info.trackName || '%(title)s';
                    if (!fileName) fileName = '%(title)s';
                    parts.push(fileName + '.mp3');
                }
                
                exampleDiv.textContent = 'Example: ' + path + parts.join('\\');
            } catch (error) {
                console.error('Error updating example:', error);
            }
        }

        if (exampleDiv) {
            pathInput.addEventListener('input', updateExample);
            chkUploader.addEventListener('change', updateExample);
            if (chkAlbum) chkAlbum.addEventListener('change', updateExample);
            if (chkIndex) chkIndex.addEventListener('change', updateExample);
            updateExample();
        }

        const confirmBtn = box.querySelector('#confirm-download');
        const pathError = box.querySelector('#path-error');
        
        confirmBtn.onclick = async () => {
            try {
                // Path validation
                const inputPath = pathInput.value.trim() || 'C:\\Downloads\\';
                if (!validatePath(inputPath)) {
                    pathError.textContent = 'Invalid path. Path contains invalid characters.';
                    pathError.style.display = 'block';
                    pathInput.style.border = '1px solid #ff6b6b';
                    return;
                }
                pathError.style.display = 'none';
                pathInput.style.border = '';
                
                // Custom parameters validation
                const custom = customParams.value.trim();
                if (custom && !validateCustomParams(custom)) {
                    showNotification('Invalid custom parameters. Dangerous characters detected.', 'error');
                    customParams.style.border = '1px solid #ff6b6b';
                    return;
                }
                customParams.style.border = '';
                
                // Save user settings
                const userSettings = {
                    path: inputPath,
                    template: box.querySelector('#template-select').value,
                    custom: custom,
                    chkUploader: chkUploader.checked,
                    chkAlbum: chkAlbum ? chkAlbum.checked : false,
                    chkIndex: chkIndex ? chkIndex.checked : false,
                    chkEmbedThumbnail: chkEmbedThumbnail.checked,
                    chkAddMetadata: chkAddMetadata.checked,
                    chkNoOverwrites: chkNoOverwrites.checked,
                    chkUseCookies: chkUseCookies.checked
                };
                saveUserSettings(service, userSettings);
                GM_setValue(service + '_last_path', inputPath);
                
                // Build command
                let template = userSettings.template;
                let basePath = inputPath;
                if (!basePath.endsWith('\\')) basePath += '\\';
                let extra = '';
                if (chkUploader.checked) extra += '%(uploader)s\\';
                // For albums and artist pages add album folder if option is enabled
                // yt-dlp will determine album name from each track's metadata
                if (chkAlbum && chkAlbum.checked && showAlbum) extra += '%(album)s\\';
                if (chkIndex && chkIndex.checked && showIndex) extra += '%(album_index)s. ';
                let fullOutput = `${basePath}${extra}%(title)s.%(ext)s`;
                let url = targetUrl;
                
                let params = [`url=${encodeURIComponent(url)}`];
                if (template) params.push(`template=${encodeURIComponent(template)}`);
                params.push(`output=${encodeURIComponent(fullOutput)}`);
                if (custom) params.push(`custom=${encodeURIComponent(custom)}`);
                if (chkEmbedThumbnail.checked) params.push('embedThumbnail=true');
                if (chkAddMetadata.checked) params.push('addMetadata=true');
                if (chkNoOverwrites.checked) params.push('noOverwrites=true');
                
                // Export cookies if option is enabled
                if (chkUseCookies.checked) {
                    try {
                        const cookiesFile = exportCookies();
                        if (cookiesFile.trim().length > 50) {
                            const cookiesBase64 = btoa(unescape(encodeURIComponent(cookiesFile)));
                            params.push(`cookiesData=${encodeURIComponent(cookiesBase64)}`);
                        } else {
                            console.warn('No cookies found or cookies file is empty');
                        }
                    } catch (error) {
                        console.error('Failed to export cookies:', error);
                    }
                }
                
                let ytdlUrl = `ytdl:?${params.join('&')}`;
                
                // Show notification
                showNotification('Starting download...', 'info', 2000);
                
                // Start download
                window.location.href = ytdlUrl;
                overlay.remove();
            } catch (error) {
                console.error('Error in confirm download:', error);
                showNotification('Error starting download. Please try again.', 'error');
            }
        };

            overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
        } catch (error) {
            console.error('Error opening dialog:', error);
            showNotification('Error opening download dialog. Please refresh the page.', 'error');
        }
    }
})();

