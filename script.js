import removeBackground from '@imgly/background-removal';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadInput = document.getElementById('upload-input');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const mediaLibrary = document.getElementById('media-library');
    const toolControls = document.getElementById('tool-controls');
    const canvasPlaceholder = document.getElementById('canvas-placeholder');
    const previewPanel = document.getElementById('preview-panel');
    const loader = document.getElementById('loader');
    const videoPreview = document.getElementById('video-preview');
    const timelineContainer = document.getElementById('timeline-container');
    const timelineTracks = document.getElementById('timeline-tracks');
    const timelinePlayhead = document.getElementById('timeline-playhead');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const timeDisplay = document.getElementById('time-display');
    const subtitleOverlay = document.getElementById('subtitle-overlay');
    const zoomSlider = document.getElementById('zoom-slider');
    const exportModal = document.getElementById('export-modal');
    const cancelExportBtn = document.getElementById('cancel-export-btn');
    const confirmExportBtn = document.getElementById('confirm-export-btn');

    // AI Model State
    let objectDetectionModel = null;

    // Editor State
    let editorState = {
        media: [],
        timeline: {
            tracks: [
                { id: 'v1', type: 'video', clips: [] },
                { id: 's1', type: 'subtitle', clips: [] },
                { id: 'a1', type: 'audio', clips: [] }
            ],
            currentTime: 0,
            duration: 0,
            isPlaying: false,
            zoom: 50, // pixels per second
        },
        selectedClip: null,
        // Image specific state (will be used when an image clip is selected)
        imageState: {
             originalImage: null,
             currentImage: null,
             filter: 'none',
             memeText: { top: '', bottom: '' },
             detectedObjects: [], // For object detection results
        },
        dragState: null, // For timeline drag-and-drop
    };

    // --- AI Model Loading ---
    async function loadObjectModel() {
        showLoader(true);
        loader.querySelector('p').textContent = 'Carregando modelo de IA...';
        try {
            objectDetectionModel = await cocoSsd.load();
            console.log('Modelo de detecção de objetos carregado.');
        } catch (err) {
            console.error('Falha ao carregar modelo de IA:', err);
            alert('Não foi possível carregar o modelo de IA. Algumas funcionalidades podem não estar disponíveis.');
        } finally {
            showLoader(false);
            loader.querySelector('p').textContent = 'Processando com IA...';
        }
    }
    loadObjectModel(); // Load model on page start

    // Event Listeners
    uploadInput.addEventListener('change', handleFileUpload);
    playPauseBtn.addEventListener('click', togglePlayback);
    videoPreview.addEventListener('timeupdate', updateTimelineFromVideo);
    videoPreview.addEventListener('loadedmetadata', () => {
        // When video metadata is loaded, update timeline if duration changed
        const videoTrack = editorState.timeline.tracks.find(t => t.type === 'video');
        if (videoTrack.clips.length > 0) {
            updateTimeline();
        }
    });
    videoPreview.addEventListener('ended', () => {
        editorState.timeline.isPlaying = false;
        updatePlaybackUI();
    });
    // Use event delegation for tool controls
    toolControls.addEventListener('click', handleToolClick);
    toolControls.addEventListener('input', handleToolInput);
    window.addEventListener('resize', redrawCanvas);

    timelineContainer.addEventListener('mousedown', handleTimelineInteraction);
    timelineContainer.addEventListener('dragover', handleTimelineDragOver);
    timelineContainer.addEventListener('drop', handleTimelineDrop);
    timelineContainer.addEventListener('dragleave', e => {
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    zoomSlider.addEventListener('input', handleZoom);
    cancelExportBtn.addEventListener('click', () => exportModal.classList.add('hidden'));
    confirmExportBtn.addEventListener('click', handleConfirmExport);

    function handleTimelineInteraction(e) {
        if (e.target.classList.contains('timeline-clip') || e.target.classList.contains('clip-handle')) return;

        const timelineRect = timelineContainer.getBoundingClientRect();
        const startX = e.clientX - timelineRect.left + timelineContainer.scrollLeft;
        
        seek(startX);

        const onMouseMove = (moveEvent) => {
            const moveX = moveEvent.clientX - timelineRect.left + timelineContainer.scrollLeft;
            seek(moveX);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function seek(x) {
        const newTime = Math.max(0, x / editorState.timeline.zoom);
        if (newTime <= editorState.timeline.duration) {
            videoPreview.currentTime = newTime;
            editorState.timeline.currentTime = newTime;
            updateTimelineFromVideo();
        }
    }
    
    function handleZoom() {
        editorState.timeline.zoom = parseInt(zoomSlider.value, 10);
        renderTimeline();
        // Also update playhead position after zoom
        timelinePlayhead.style.left = `${editorState.timeline.currentTime * editorState.timeline.zoom}px`;
    }

    function handleToolClick(e) {
        const target = e.target.closest('button');
        if (!target) return;

        const id = target.id;
        const action = target.dataset.action;

        if (action === 'alert-not-implemented') {
            alert('Esta funcionalidade é complexa e será implementada em uma versão futura.');
            return;
        }

        if (target.classList.contains('filter-btn')) {
            editorState.imageState.filter = target.dataset.filter;
            redrawCanvas();
        } else if (id === 'reset-filters-btn') {
            editorState.imageState.filter = 'none';
            editorState.imageState.currentImage = editorState.imageState.originalImage;
            editorState.imageState.detectedObjects = []; // Clear detections on reset
            redrawCanvas();
        } else if (id === 'ai-enhance-btn') {
            editorState.imageState.filter = 'brightness(120%) contrast(110%) saturate(110%)';
            redrawCanvas();
        } else if (id === 'ai-bg-remove-btn') {
            handleBackgroundRemoval();
        } else if (id === 'ai-meme-btn') {
            suggestMeme();
        } else if (id === 'ai-detect-objects-btn') {
            detectObjects();
        } else if (id === 'ai-auto-captions-btn') {
            generateAutoCaptions();
        } else if (id === 'download-btn') {
            openExportModal();
        }
    }
    
    function handleToolInput(e) {
        const target = e.target;
        if (!target) return;
        
        const id = target.id;
        const action = target.dataset.action;

        if (id === 'top-text') {
            editorState.imageState.memeText.top = e.target.value;
            redrawCanvas();
        } else if (id === 'bottom-text') {
            editorState.imageState.memeText.bottom = e.target.value;
            redrawCanvas();
        } else if (action === 'volume-control') {
            if(editorState.selectedClip) {
                const media = editorState.media.find(m => m.id === editorState.selectedClip.mediaId);
                if (media.type === 'video') {
                     videoPreview.volume = target.value / 100;
                }
            }
        } else if (action === 'speed-control') {
            if (editorState.selectedClip) {
                videoPreview.playbackRate = target.value;
                document.getElementById('speed-value').textContent = `${target.value}x`;
            }
        }
    }

    function showLoader(visible, text = 'Processando com IA...') {
        loader.querySelector('p').textContent = text;
        loader.classList.toggle('hidden', !visible);
    }

    function handleFileUpload(e) {
        const files = e.target.files;
        if (!files.length) return;

        for (const file of files) {
             const reader = new FileReader();
             reader.onload = (event) => {
                 const media = {
                    id: `media-${Date.now()}-${Math.random()}`,
                    name: file.name,
                    src: event.target.result,
                    type: file.type.split('/')[0], // 'image', 'video', 'audio'
                 };
                 
                 if (media.type === 'video' || media.type === 'audio') {
                     const mediaEl = document.createElement(media.type); // video or audio element
                     mediaEl.onloadedmetadata = () => {
                         media.duration = mediaEl.duration;
                         editorState.media.push(media);
                         renderMediaLibrary();
                         // Automatically add first video to timeline
                         if (media.type === 'video' && editorState.timeline.tracks.find(t=>t.type==='video').clips.length === 0) {
                            addClipToTimeline(media);
                         }
                         // Automatically add first audio to timeline
                         if (media.type === 'audio' && editorState.timeline.tracks.find(t=>t.type==='audio').clips.length === 0) {
                            addClipToTimeline(media);
                         }
                     };
                     mediaEl.src = media.src;
                 } else if (media.type === 'image') {
                     const img = new Image();
                     img.onload = () => {
                        media.duration = 5; // default duration for images
                        media.width = img.width;
                        media.height = img.height;
                        editorState.media.push(media);
                        renderMediaLibrary();
                     };
                     img.src = media.src;
                 }
             };
             reader.readAsDataURL(file);
        }
    }

    function renderMediaLibrary() {
        if (editorState.media.length === 0) {
            mediaLibrary.innerHTML = `<p class="placeholder-text">Sua mídia aparecerá aqui.</p>`;
            return;
        }
        
        mediaLibrary.innerHTML = '';
        editorState.media.forEach(media => {
            const el = document.createElement('div');
            el.className = 'media-item';
            el.dataset.mediaId = media.id;

            let thumbnail;
            if (media.type === 'image') {
                thumbnail = `<img src="${media.src}" alt="${media.name}">`;
            } else if (media.type === 'video') {
                thumbnail = `<i class="fa-solid fa-film"></i>`;
            } else if (media.type === 'audio') {
                 thumbnail = `<i class="fa-solid fa-music"></i>`;
            }
            
            el.innerHTML = `
                <div class="media-thumbnail">${thumbnail}</div>
                <span class="media-name">${media.name}</span>
            `;

            el.addEventListener('click', () => {
                addClipToTimeline(media);
            });

            mediaLibrary.appendChild(el);
        });
    }

    function selectImageForPreview(media) {
        const img = new Image();
        img.onload = () => {
            // Update editor state for the selected image
            editorState.imageState.originalImage = img;
            editorState.imageState.currentImage = img;
            editorState.imageState.filter = 'none';
            editorState.imageState.memeText = { top: '', bottom: '' };
            editorState.imageState.detectedObjects = [];
            // Do not deselect clip if we are selecting an image from the timeline
            // editorState.selectedClip = null; 

            // Show canvas and hide video/placeholder
            videoPreview.style.display = 'none';
            videoPreview.pause();
            
            canvas.style.display = 'block';
            canvasPlaceholder.classList.remove('visible');

            // Redraw canvas with the new image
            redrawCanvas();

            // Show tools for image editing
            showImageTools();
        };
        img.src = media.src;
    }

    function addClipToTimeline(media) {
        let trackType = (media.type === 'image') ? 'video' : media.type;
        // Exception for subtitles, which are not a media type
        if (media.type === 'subtitle') {
            trackType = 'subtitle';
        }
        
        const track = editorState.timeline.tracks.find(t => t.type === trackType);
        if (!track) {
            alert(`Não há uma trilha para ${media.type}.`);
            return;
        }

        // Clear image editing state when adding video/audio
        if (media.type === 'video' || media.type === 'audio') {
            editorState.imageState.currentImage = null;
            editorState.imageState.originalImage = null;
        }
        
        // Find end time of last clip on track
        const startTime = track.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);

        const clip = {
            id: `clip-${Date.now()}`,
            mediaId: media.id,
            start: startTime,
            end: startTime + (media.duration || 5),
            duration: media.duration || 5, // Default 5s for images
            trackId: track.id,
        };
        track.clips.push(clip);
        updateTimeline();
        renderTimeline();
    }

    function updateTimeline() {
        const videoTrack = editorState.timeline.tracks.find(t => t.type === 'video');
        if (!videoTrack) return;
        
        editorState.timeline.duration = videoTrack.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
        
        if (videoTrack.clips.length > 0) {
            const firstClipMedia = editorState.media.find(m => m.id === videoTrack.clips[0].mediaId);
            if (firstClipMedia && videoPreview.src !== firstClipMedia.src && firstClipMedia.type === 'video') {
                videoPreview.src = firstClipMedia.src;
                videoPreview.style.display = 'block';
                canvas.style.display = 'none';
                canvasPlaceholder.classList.remove('visible');
            } else if (firstClipMedia && firstClipMedia.type === 'image') {
                // If the first clip is an image, show it
                selectImageForPreview(firstClipMedia);
            }
        } else if (!editorState.imageState.currentImage) { // Only hide if no image is being previewed
             videoPreview.style.display = 'none';
             canvas.style.display = 'block'; // Fallback to canvas for image editing
             if (!editorState.imageState.currentImage) {
                 canvas.style.display = 'none';
                 canvasPlaceholder.classList.add('visible');
             }
        }
        
        updateTimeDisplay();
    }
    
    function renderTimeline() {
        timelineTracks.innerHTML = '';
        editorState.timeline.tracks.forEach(track => {
            const trackEl = document.createElement('div');
            trackEl.className = 'timeline-track';
            trackEl.dataset.trackId = track.id;
            trackEl.dataset.trackType = track.type;
            
            if (track.type === 'subtitle') {
                trackEl.classList.add('subtitle-track');
            }

            track.clips.forEach(clip => {
                const media = editorState.media.find(m => m.id === clip.mediaId) || { name: clip.text, type: 'subtitle' };
                const clipEl = document.createElement('div');
                clipEl.className = 'timeline-clip';
                if(media.type === 'subtitle') clipEl.classList.add('subtitle-clip');

                clipEl.style.left = `${clip.start * editorState.timeline.zoom}px`;
                clipEl.style.width = `${clip.duration * editorState.timeline.zoom}px`;
                clipEl.textContent = media.name;
                clipEl.dataset.clipId = clip.id;
                clipEl.draggable = true;

                clipEl.addEventListener('dragstart', e => handleClipDragStart(e, clip));
                
                clipEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectClip(clip);
                });

                // Add resize handles
                const leftHandle = document.createElement('div');
                leftHandle.className = 'clip-handle left';
                leftHandle.addEventListener('mousedown', e => initResize(e, clip, 'left'));
                clipEl.appendChild(leftHandle);

                const rightHandle = document.createElement('div');
                rightHandle.className = 'clip-handle right';
                rightHandle.addEventListener('mousedown', e => initResize(e, clip, 'right'));
                clipEl.appendChild(rightHandle);

                trackEl.appendChild(clipEl);
            });
            if (track.clips.length === 0) {
                const typeIcon = track.type === 'video' ? 'fa-video' : (track.type === 'subtitle' ? 'fa-closed-captioning' : 'fa-waveform');
                const typeText = track.type === 'video' ? 'Trilha de Vídeo' : (track.type === 'subtitle' ? 'Trilha de Legendas' : 'Trilha de Áudio');
                 trackEl.innerHTML = `<div class="timeline-placeholder">
                    <i class="fa-solid ${typeIcon}"></i>
                    <span>${typeText}</span>
                </div>`;
            }
            timelineTracks.appendChild(trackEl);
        });
    }

    function selectClip(clip) {
        editorState.selectedClip = clip;
        showToolsForClip(clip);
        
        // Update selection visual
        document.querySelectorAll('.timeline-clip').forEach(el => {
            el.classList.toggle('selected-clip', el.dataset.clipId === clip.id);
        });
    }

    function togglePlayback() {
        if(editorState.timeline.duration === 0) return;
        editorState.timeline.isPlaying = !editorState.timeline.isPlaying;
        if (editorState.timeline.isPlaying) {
            videoPreview.play();
        } else {
            videoPreview.pause();
        }
        updatePlaybackUI();
    }
    
    function updatePlaybackUI() {
        if(editorState.timeline.isPlaying) {
            playPauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        } else {
            playPauseBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        }
    }

    function updateTimelineFromVideo() {
        editorState.timeline.currentTime = videoPreview.currentTime;
        timelinePlayhead.style.left = `${editorState.timeline.currentTime * editorState.timeline.zoom}px`;
        updateTimeDisplay();
        updateSubtitles();
    }

    function updateSubtitles() {
        const subtitleTrack = editorState.timeline.tracks.find(t => t.type === 'subtitle');
        if (!subtitleTrack) return;

        const currentTime = editorState.timeline.currentTime;
        const currentClip = subtitleTrack.clips.find(clip => currentTime >= clip.start && currentTime < (clip.start + clip.duration));

        if (currentClip) {
            subtitleOverlay.textContent = currentClip.text;
            subtitleOverlay.style.display = 'block';
        } else {
            subtitleOverlay.style.display = 'none';
        }
    }
    
    function updateTimeDisplay() {
         const formatTime = (time) => {
            const minutes = Math.floor(time / 60).toString().padStart(2, '0');
            const seconds = (time % 60).toFixed(1).toString().padStart(4, '0');
            return `${minutes}:${seconds}`;
        };
        timeDisplay.textContent = `${formatTime(editorState.timeline.currentTime)} / ${formatTime(editorState.timeline.duration)}`;
    }
    
    function showToolsForClip(clip) {
        const media = editorState.media.find(m => m.id === clip.mediaId);
        if (media.type === 'video') {
            showVideoTools();
        } else if (media.type === 'audio') {
            showAudioTools();
        } else if (media.type === 'image') {
            // This case would be for images on the timeline, which isn't fully supported yet.
            // For now, image editing happens outside the timeline flow.
            selectImageForPreview(media);
        }
    }

    function showVideoTools() {
         toolControls.innerHTML = `
            <div class="tool-section">
                <h3><i class="fa-solid fa-sliders"></i> Controles de Clipe</h3>
                <label for="volume-control">Volume:</label>
                <input type="range" id="volume-control" data-action="volume-control" min="0" max="100" value="${videoPreview.volume * 100}">
                <label for="speed-control">Velocidade: <span id="speed-value">${videoPreview.playbackRate}x</span></label>
                <input type="range" id="speed-control" data-action="speed-control" min="0.25" max="2" step="0.25" value="${videoPreview.playbackRate}">
            </div>
            <div class="tool-section">
                <h3><i class="fa-solid fa-scissors"></i> Edição de Vídeo</h3>
                <button class="tool-btn" data-action="alert-not-implemented"><i class="fa-solid fa-crop-simple"></i> Cortar</button>
                <button class="tool-btn" data-action="alert-not-implemented"><i class="fa-solid fa-gauge-high"></i> Velocidade</button>
            </div>
             <div class="tool-section">
                <h3><i class="fa-solid fa-robot"></i> Ferramentas IA (Vídeo)</h3>
                <button class="tool-btn ai-btn" data-action="alert-not-implemented"><i class="fa-solid fa-wand-magic-sparkles"></i> Remoção de Fundo IA</button>
                <button class="tool-btn ai-btn" id="ai-auto-captions-btn"><i class="fa-solid fa-closed-captioning"></i> Legendas Automáticas</button>
                <button class="tool-btn ai-btn" data-action="alert-not-implemented"><i class="fa-solid fa-comments"></i> Sugerir Cortes</button>
            </div>
            <div class="tool-section">
                <h3><i class="fa-solid fa-download"></i> Exportar</h3>
                <button class="tool-btn" id="download-btn" style="width:100%"><i class="fa-solid fa-save"></i> Exportar Vídeo</button>
            </div>
        `;
    }

    function showAudioTools() {
        toolControls.innerHTML = `
            <div class="tool-section">
                <h3><i class="fa-solid fa-sliders"></i> Edição de Áudio</h3>
                <button class="tool-btn"><i class="fa-solid fa-volume-high"></i> Volume</button>
                <button class="tool-btn"><i class="fa-solid fa-waveform"></i> Fade In/Out</button>
            </div>
             <div class="tool-section">
                <h3><i class="fa-solid fa-robot"></i> Ferramentas IA (Áudio)</h3>
                <button class="tool-btn ai-btn" data-action="alert-not-implemented"><i class="fa-solid fa-microphone-lines-slash"></i> Redução de Ruído IA</button>
                <button class="tool-btn ai-btn" data-action="alert-not-implemented"><i class="fa-solid fa-voicemail"></i> Transcrição de Voz</button>
            </div>
        `;
    }

    function showImageTools() {
        // This is the adapted version of the old `showTools` function
        toolControls.innerHTML = `
            <div class="tool-section">
                <h3><i class="fa-solid fa-robot"></i> Ferramentas IA</h3>
                <div class="ai-tools-grid">
                    <button class="tool-btn ai-btn" id="ai-enhance-btn"><i class="fa-solid fa-star"></i> Auto-Melhoria</button>
                    <button class="tool-btn ai-btn" id="ai-bg-remove-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Remover Fundo</button>
                    <button class="tool-btn ai-btn" id="ai-detect-objects-btn"><i class="fa-solid fa-robot"></i> Detectar Objetos</button>
                    <button class="tool-btn ai-btn" id="ai-meme-btn"><i class="fa-solid fa-comment-dots"></i> Sugerir Meme</button>
                </div>
            </div>
            <div class="tool-section">
                <h3><i class="fa-solid fa-palette"></i> Filtros e Efeitos</h3>
                <div class="filter-grid">
                    <button class="filter-btn" data-filter="none">Normal</button>
                    <button class="filter-btn" data-filter="grayscale(100%)">Preto & Branco</button>
                    <button class="filter-btn" data-filter="sepia(100%)">Sépia</button>
                    <button class="filter-btn" data-filter="invert(100%)">Inverter</button>
                    <button class="filter-btn" data-filter="brightness(130%)">Brilho+</button>
                    <button class="filter-btn" data-filter="contrast(150%)">Contraste+</button>
                </div>
                 <button class="tool-btn" id="reset-filters-btn" style="width:100%; margin-top:10px;"><i class="fa-solid fa-arrow-rotate-left"></i> Resetar Efeitos</button>
            </div>
            <div class="tool-section">
                <h3><i class="fa-solid fa-font"></i> Criador de Memes</h3>
                <div class="meme-controls">
                    <label for="top-text">Texto Superior:</label>
                    <input type="text" id="top-text" placeholder="Texto superior aqui..." value="${editorState.imageState.memeText.top}">
                    <label for="bottom-text">Texto Inferior:</label>
                    <input type="text" id="bottom-text" placeholder="Texto inferior aqui..." value="${editorState.imageState.memeText.bottom}">
                </div>
            </div>
             <div class="tool-section">
                <h3><i class="fa-solid fa-download"></i> Exportar</h3>
                <button class="tool-btn" id="download-btn" style="width:100%"><i class="fa-solid fa-save"></i> Salvar Imagem</button>
            </div>
        `;
    }
    
    function calculateAspectRatioFit(srcWidth, srcHeight, maxWidth, maxHeight) {
        const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
        return { width: srcWidth * ratio, height: srcHeight * ratio };
    }

    function redrawCanvas() {
        if (!editorState.imageState.currentImage) return;

        const { currentImage, filter, memeText, detectedObjects } = editorState.imageState;

        const previewRect = previewPanel.getBoundingClientRect();
        // Subtract padding from available space
        const maxWidth = previewRect.width - 32;
        const maxHeight = previewRect.height - 32;

        const dimensions = calculateAspectRatioFit(currentImage.width, currentImage.height, maxWidth, maxHeight);
        
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;

        // If canvas is not visible, don't draw
        if (canvas.style.display === 'none') return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = filter;
        ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
        
        // Reset filter before drawing text, so text is not filtered
        ctx.filter = 'none';

        if (detectedObjects.length > 0) {
            drawObjectDetections();
        }

        if (memeText.top || memeText.bottom) {
            drawMemeText();
        }
    }

    function drawObjectDetections() {
        const { detectedObjects } = editorState.imageState;
        const scaleX = canvas.width / (editorState.imageState.currentImage.naturalWidth || editorState.imageState.currentImage.width);
        const scaleY = canvas.height / (editorState.imageState.currentImage.naturalHeight || editorState.imageState.currentImage.height);

        detectedObjects.forEach(prediction => {
            const [x, y, width, height] = prediction.bbox;
            const scaledX = x * scaleX;
            const scaledY = y * scaleY;
            const scaledWidth = width * scaleX;
            const scaledHeight = height * scaleY;

            // Draw the bounding box.
            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = 2;
            ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

            // Draw the label background.
            ctx.fillStyle = '#00aaff';
            const text = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillRect(scaledX, scaledY, textWidth + 8, 20);

            // Draw the label text.
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Arial';
            ctx.fillText(text, scaledX + 4, scaledY + 14);
        });
    }

    function drawMemeText() {
        const { memeText } = editorState.imageState;
        
        const fontSize = Math.max(20, Math.floor(canvas.width / 15));
        ctx.font = `bold ${fontSize}px Impact`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = Math.max(1, fontSize / 15);
        ctx.textAlign = 'center';

        const topY = fontSize * 1.2;
        const bottomY = canvas.height - (fontSize * 0.5);

        if (memeText.top) {
            const x = canvas.width / 2;
            ctx.strokeText(memeText.top.toUpperCase(), x, topY);
            ctx.fillText(memeText.top.toUpperCase(), x, topY);
        }
        if (memeText.bottom) {
            const x = canvas.width / 2;
            ctx.strokeText(memeText.bottom.toUpperCase(), x, bottomY);
            ctx.fillText(memeText.bottom.toUpperCase(), x, bottomY);
        }
    }
    
    async function handleBackgroundRemoval() {
        if (!editorState.imageState.originalImage) return;
        showLoader(true);
        try {
            const blob = await removeBackground(editorState.imageState.originalImage.src);
            const url = URL.createObjectURL(blob);
            const newImg = new Image();
            newImg.onload = () => {
                editorState.imageState.currentImage = newImg;
                // Keep original dimensions if possible, by replacing originalImage as well
                editorState.imageState.originalImage = newImg;
                redrawCanvas();
                showLoader(false);
                URL.revokeObjectURL(url); // Clean up memory
            };
            newImg.onerror = () => {
                alert('Falha ao carregar a imagem com fundo removido.');
                showLoader(false);
            }
            newImg.src = url;
        } catch (error) {
            console.error('Background removal failed:', error);
            alert('Falha ao remover o fundo da imagem.');
            showLoader(false);
        }
    }

    async function detectObjects() {
        if (!editorState.imageState.currentImage || !objectDetectionModel) {
            alert('Carregue uma imagem e espere o modelo de IA carregar.');
            return;
        }
        showLoader(true, 'Detectando objetos...');
        try {
            const predictions = await objectDetectionModel.detect(editorState.imageState.currentImage);
            editorState.imageState.detectedObjects = predictions;
            redrawCanvas();
        } catch (err) {
            console.error('Object detection failed:', err);
            alert('Falha ao detectar objetos na imagem.');
        } finally {
            showLoader(false);
        }
    }

    function generateAutoCaptions() {
        const videoTrack = editorState.timeline.tracks.find(t => t.type === 'video');
        if (!videoTrack || videoTrack.clips.length === 0) {
            alert('Adicione um vídeo à linha do tempo primeiro.');
            return;
        }
        showLoader(true, 'Gerando legendas automáticas...');
        
        // Simulate AI processing
        setTimeout(() => {
            const subtitleTrack = editorState.timeline.tracks.find(t => t.type === 'subtitle');
            subtitleTrack.clips = []; // Clear existing subtitles

            const mockSubtitles = [
                { start: 1, duration: 3, text: "Olá! Este é um exemplo de legenda automática." },
                { start: 5, duration: 4, text: "A inteligência artificial pode transcrever o áudio." },
                { start: 10, duration: 3, text: "Isso torna os vídeos mais acessíveis." },
                { start: 14, duration: 5, text: "Obrigado por testar esta funcionalidade." }
            ];

            mockSubtitles.forEach((sub, index) => {
                if (sub.start < editorState.timeline.duration) {
                     const clip = {
                        id: `sub-${Date.now()}-${index}`,
                        text: sub.text,
                        start: sub.start,
                        duration: sub.duration,
                        trackId: subtitleTrack.id,
                    };
                    subtitleTrack.clips.push(clip);
                }
            });
            
            renderTimeline();
            showLoader(false);

        }, 2000); // 2 second delay to simulate processing
    }

    function suggestMeme() {
        const topTexts = ["Aquele momento que", "Quando você percebe que", "Minha cara quando", "Ninguém:", "Absolutamente ninguém:"];
        const bottomTexts = ["... a sexta-feira chegou.", "... o café acaba.", "... o Wi-Fi cai.", "... eu existo.", "... esqueci o que ia fazer."];
        
        editorState.imageState.memeText.top = topTexts[Math.floor(Math.random() * topTexts.length)];
        editorState.imageState.memeText.bottom = bottomTexts[Math.floor(Math.random() * bottomTexts.length)];
        
        // update input fields and redraw
        document.getElementById('top-text').value = editorState.imageState.memeText.top;
        document.getElementById('bottom-text').value = editorState.imageState.memeText.bottom;
        redrawCanvas();
    }

    function downloadImage() {
        if (!editorState.imageState.currentImage) return;
        
        // Create a temporary canvas for full-resolution export
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        const { currentImage, filter, memeText, detectedObjects } = editorState.imageState;

        tempCanvas.width = currentImage.naturalWidth || currentImage.width;
        tempCanvas.height = currentImage.naturalHeight || currentImage.height;
        
        // Apply filter and draw image
        tempCtx.filter = filter;
        tempCtx.drawImage(currentImage, 0, 0);
        tempCtx.filter = 'none';

        // Draw text, scaled to original image size
        const fontSize = Math.max(20, Math.floor(tempCanvas.width / 15));
        tempCtx.font = `bold ${fontSize}px Impact`;
        tempCtx.fillStyle = 'white';
        tempCtx.strokeStyle = 'black';
        tempCtx.lineWidth = Math.max(1, fontSize / 15);
        tempCtx.textAlign = 'center';

        if (memeText.top) {
             tempCtx.strokeText(memeText.top.toUpperCase(), tempCanvas.width / 2, fontSize * 1.2);
             tempCtx.fillText(memeText.top.toUpperCase(), tempCanvas.width / 2, fontSize * 1.2);
        }
        if (memeText.bottom) {
             tempCtx.strokeText(memeText.bottom.toUpperCase(), tempCanvas.width / 2, tempCanvas.height - (fontSize * 0.5));
             tempCtx.fillText(memeText.bottom.toUpperCase(), tempCanvas.width / 2, tempCanvas.height - (fontSize * 0.5));
        }

        // Trigger download
        const link = document.createElement('a');
        link.download = 'edited-image.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    function exportVideo() {
        showLoader(true, 'Preparando para exportar...');
        setTimeout(() => {
            showLoader(true, 'Renderizando vídeo... (Simulação)');
            // Simulate a rendering process
            setTimeout(() => {
                showLoader(false);
                alert("A renderização do vídeo está concluída! O download começará.");
                
                // As a placeholder, we download the source video file.
                // A real implementation would require a library like ffmpeg.wasm to combine clips, audio, and effects.
                const videoTrack = editorState.timeline.tracks.find(t => t.type === 'video');
                if (videoTrack.clips.length > 0) {
                    const firstClipMedia = editorState.media.find(m => m.id === videoTrack.clips[0].mediaId);
                    if (firstClipMedia && firstClipMedia.type === 'video') {
                        const link = document.createElement('a');
                        link.href = firstClipMedia.src;
                        link.download = `exported-video-${Date.now()}.mp4`;
                        link.click();
                    } else {
                        alert('A exportação de vídeos compostos por imagens ainda não é suportada.');
                    }
                } else {
                    alert('Nenhum clipe de vídeo na linha do tempo para exportar.');
                }
            }, 3000);
        }, 1500);
    }

    // --- Timeline Interaction Functions ---
    function handleClipDragStart(e, clip) {
        e.dataTransfer.effectAllowed = 'move';
        editorState.dragState = { clip };
    }

    function handleTimelineDragOver(e) {
        e.preventDefault();
        const targetTrackEl = e.target.closest('.timeline-track');
        if (!targetTrackEl) return;

        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        targetTrackEl.classList.add('drag-over');
    }

    function handleTimelineDrop(e) {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        const { clip } = editorState.dragState;
        if (!clip) return;

        const targetTrackEl = e.target.closest('.timeline-track');
        if (!targetTrackEl) return;

        const originalTrack = editorState.timeline.tracks.find(t => t.id === clip.trackId);
        const newTrack = editorState.timeline.tracks.find(t => t.id === targetTrackEl.dataset.trackId);
        const media = editorState.media.find(m => m.id === clip.mediaId);
        const mediaType = media.type === 'image' ? 'video' : media.type;
        
        if (newTrack.type !== mediaType) {
            alert(`Não é possível mover um clipe de ${media.type} para uma trilha de ${newTrack.type}.`);
            return;
        }

        const timelineRect = timelineContainer.getBoundingClientRect();
        const dropX = e.clientX - timelineRect.left + timelineContainer.scrollLeft;
        const newStartTime = Math.max(0, dropX / editorState.timeline.zoom);
        
        // Remove from old track
        const clipIndex = originalTrack.clips.findIndex(c => c.id === clip.id);
        originalTrack.clips.splice(clipIndex, 1);
        
        // Update clip and add to new track
        clip.start = newStartTime;
        clip.trackId = newTrack.id;
        newTrack.clips.push(clip);
        
        updateTimeline();
        renderTimeline();
        editorState.dragState = null;
    }

    function initResize(e, clip, edge) {
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = parseFloat(document.querySelector(`[data-clip-id="${clip.id}"]`).style.width);
        const startLeft = parseFloat(document.querySelector(`[data-clip-id="${clip.id}"]`).style.left);
        const pixelsPerSecond = editorState.timeline.zoom;

        function onMouseMove(moveEvent) {
            const dx = moveEvent.clientX - startX;
            if (edge === 'right') {
                const newWidth = startWidth + dx;
                const newDuration = Math.max(0.1, newWidth / pixelsPerSecond);
                clip.duration = newDuration;
            } else if (edge === 'left') {
                const newLeft = startLeft + dx;
                const newWidth = startWidth - dx;
                if(newWidth > 10) { // minimum width
                    const newStartTime = Math.max(0, newLeft / pixelsPerSecond);
                    const durationChange = clip.start - newStartTime;
                    clip.start = newStartTime;
                    clip.duration += durationChange;
                }
            }
            updateTimeline();
            renderTimeline();
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    
    // --- Export Modal ---
    function openExportModal() {
        const optionsContainer = document.getElementById('export-options');
        let isImage = editorState.imageState.currentImage && !editorState.selectedClip?.mediaId;
        const videoTrack = editorState.timeline.tracks.find(t => t.type === 'video');
        let hasVideo = videoTrack && videoTrack.clips.some(c => editorState.media.find(m => m.id === c.mediaId)?.type === 'video');

        if(editorState.selectedClip) {
            const media = editorState.media.find(m => m.id === editorState.selectedClip.mediaId);
            if(media.type === 'image') isImage = true;
        }

        if (isImage) {
            optionsContainer.innerHTML = `
                <div class="form-group">
                    <label for="export-filename">Nome do Arquivo:</label>
                    <input type="text" id="export-filename" value="edited-image">
                </div>
                <div class="form-group">
                    <label for="export-format">Formato:</label>
                    <select id="export-format">
                        <option value="image/png">PNG</option>
                        <option value="image/jpeg">JPEG</option>
                    </select>
                </div>
            `;
        } else if (hasVideo || (videoTrack && videoTrack.clips.length > 0)) {
            optionsContainer.innerHTML = `
                 <div class="form-group">
                    <label for="export-filename">Nome do Arquivo:</label>
                    <input type="text" id="export-filename" value="exported-video">
                </div>
                <div class="form-group">
                    <label>Formato:</label>
                    <p>MP4 (Simulação)</p>
                </div>
            `;
        } else {
            alert("Nenhuma mídia para exportar. Adicione um clipe à linha do tempo ou selecione uma imagem.");
            return;
        }
        exportModal.classList.remove('hidden');
    }

    function handleConfirmExport() {
        exportModal.classList.add('hidden');
        if (editorState.imageState.currentImage && !editorState.selectedClip) {
            downloadImage();
        } else if (editorState.timeline.duration > 0) {
            exportVideo();
        } else {
             alert("Nada para exportar.");
        }
    }

    // Initial UI setup
    updateTimeline();
});