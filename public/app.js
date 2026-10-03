const startBtn = document.getElementById('startBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const stopBtn = document.getElementById('stopBtn');
const webcam = document.getElementById('webcam');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const statusBadge = document.getElementById('statusBadge');
const recordingIndicator = document.getElementById('recordingIndicator');
const logs = document.getElementById('logs');

let ws;
let mediaStream;
let audioContext;
let playbackContext;
let videoInterval;
let nextPlayTime = 0;

function log(msg, color = 'text-green-400') {
    const time = new Date().toLocaleTimeString();
    logs.innerHTML += `<span class="text-gray-500">[${time}]</span> <span class="${color}">${msg}</span><br>`;
    logs.scrollTop = logs.scrollHeight;
}

function updateStatus(status, colorClass) {
    statusBadge.textContent = status.toUpperCase();
    statusBadge.className = `px-2 py-1 text-xs font-bold rounded-md border ${colorClass}`;
}

// Ensure the module is loaded before we can instantiate it
async function initAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    
    // Add the worklet module
    await audioContext.audioWorklet.addModule('/audio-worklet.js');
}

async function startStream() {
    try {
        log('Requesting camera and microphone access...', 'text-yellow-400');
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' }, // Prefer back camera on mobile
            audio: true 
        });

        // Initialize Audio context (needs to happen after user gesture)
        if (!audioContext) {
            await initAudioContext();
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
            await playbackContext.resume();
        }
        
        webcam.srcObject = mediaStream;
        webcam.classList.remove('hidden');
        cameraPlaceholder.classList.add('hidden');
        
        connectWebSocket();
        
        startBtn.classList.add('hidden');
        analyzeBtn.classList.remove('hidden');
        stopBtn.classList.remove('hidden');
        recordingIndicator.classList.remove('hidden');
    } catch (err) {
        log(`Media error: ${err.message}`, 'text-red-400');
    }
}

function stopStream() {
    if (ws) ws.close();
    if (videoInterval) clearInterval(videoInterval);
    
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    
    webcam.classList.add('hidden');
    cameraPlaceholder.classList.remove('hidden');
    
    startBtn.classList.remove('hidden');
    analyzeBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
    updateStatus('DISCONNECTED', 'bg-gray-700 text-gray-300 border-gray-600');
    log('Stream stopped.', 'text-gray-400');
}

function connectWebSocket() {
    log('Connecting to server...', 'text-blue-400');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        updateStatus('CONNECTED', 'bg-green-900 text-green-300 border-green-700');
        log('WebSocket connected. Initializing Gemini pipeline...');
        
        // Start processing audio
        setupAudioCapture();
        
        // Start sending video frames
        setupVideoCapture();
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // Handle error messages from our server
            if (data.error) {
                log(`Server Error: ${data.error}`, 'text-red-500');
                return;
            }

            // Handle setup complete
            if (data.setupComplete) {
                log('Setup Complete. Requesting initial environment analysis...', 'text-purple-400');
                triggerAnalysis("Please start describing the environment based on the video feed. What do you see?");
            }

            // Handle Gemini ServerContent responses
            if (data.serverContent && data.serverContent.modelTurn) {
                const parts = data.serverContent.modelTurn.parts;
                for (const part of parts) {
                    // Check if it's audio
                    if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                        playAudioChunk(part.inlineData.data);
                    }
                    // Handle text if Gemini also happens to send it
                    if (part.text) {
                        log(`Model: ${part.text}`, 'text-blue-300');
                    }
                }
            } else if (data.serverContent && data.serverContent.turnComplete) {
                // Model finished its turn
                log('Model finished speaking', 'text-gray-500');
            }

        } catch (e) {
            console.error('Failed to parse WS message:', e);
        }
    };
    
    ws.onclose = () => {
        updateStatus('DISCONNECTED', 'bg-gray-700 text-gray-300 border-gray-600');
        log('WebSocket disconnected.', 'text-yellow-500');
        stopStream();
    };
}

function setupAudioCapture() {
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = new AudioWorkletNode(audioContext, 'pcm-processor');
    
    processor.port.onmessage = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const pcm16Data = e.data;
            // Convert ArrayBuffer to Base64
            let binary = '';
            const bytes = new Uint8Array(pcm16Data);
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Audio = btoa(binary);
            
            ws.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Audio
                    }]
                }
            }));
        }
    };
    
    source.connect(processor);
    processor.connect(audioContext.destination); // Required to keep worklet alive in some browsers
    log('Microphone 16kHz PCM stream started.');
}

function setupVideoCapture() {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    
    // 3. Visual Frame Throttling: 1 FPS at 768x768
    videoInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (webcam.videoWidth === 0) return; // Video not yet loaded
        
        // Center crop to square
        const size = Math.min(webcam.videoWidth, webcam.videoHeight);
        const sx = (webcam.videoWidth - size) / 2;
        const sy = (webcam.videoHeight - size) / 2;
        
        ctx.drawImage(webcam, sx, sy, size, size, 0, 0, 768, 768);
        
        // Extract JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64Jpeg = dataUrl.split(',')[1];
        
        ws.send(JSON.stringify({
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "image/jpeg",
                    data: base64Jpeg
                }]
            }
        }));
        
        // Optional: show small visual indicator of frame send
    }, 1000); // 1000ms = 1 FPS
    
    log('Video 1 FPS frame throttling started.');
}

function playAudioChunk(base64Data) {
    try {
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        const audioBuffer = playbackContext.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);
        
        const source = playbackContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackContext.destination);
        
        // Schedule playback sequentially to avoid stuttering
        const currentTime = playbackContext.currentTime;
        if (nextPlayTime < currentTime) {
            nextPlayTime = currentTime;
        }
        
        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
    } catch (e) {
        console.error('Audio playback error:', e);
    }
}

function triggerAnalysis(promptText = "What do you see right now? Describe the environment.") {
    if (ws && ws.readyState === WebSocket.OPEN) {
        log(`Triggering analysis: "${promptText}"`);
        ws.send(JSON.stringify({
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text: promptText }]
                }],
                turnComplete: true
            }
        }));
    }
}

startBtn.addEventListener('click', startStream);
analyzeBtn.addEventListener('click', () => triggerAnalysis());
stopBtn.addEventListener('click', stopStream);
