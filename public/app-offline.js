import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.14/genai_bundle.mjs';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadModelBtn = document.getElementById('downloadModelBtn');
const webcam = document.getElementById('webcam');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const statusBadge = document.getElementById('statusBadge');
const recordingIndicator = document.getElementById('recordingIndicator');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logs = document.getElementById('logs');

let llmInference = null;
let mediaStream;
let recognition;
let isTranslating = false;

function log(msg, color = 'text-green-400') {
    const time = new Date().toLocaleTimeString();
    logs.innerHTML += `<span class="text-gray-500">[${time}]</span> <span class="${color}">${msg}</span><br>`;
    logs.scrollTop = logs.scrollHeight;
}

function updateStatus(status, colorClass) {
    statusBadge.textContent = status.toUpperCase();
    statusBadge.className = `px-3 py-1.5 text-xs font-bold rounded-lg border ${colorClass}`;
}

// 1. Model Downloading & Initialization
downloadModelBtn.addEventListener('click', async () => {
    downloadModelBtn.disabled = true;
    downloadModelBtn.classList.add('opacity-50', 'cursor-not-allowed');
    progressContainer.classList.remove('hidden');
    progressText.classList.remove('hidden');

    try {
        log('Fetching MediaPipe WASM Fileset...', 'text-yellow-400');
        const genaiFileset = await FilesetResolver.forGenAiTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.14/wasm'
        );

        log('Initializing WebGPU LLM Runtime...', 'text-yellow-400');
        
        // The Gemma model must be downloaded manually from Kaggle due to licensing
        let modelUrl = '/models/gemma-2b-it-gpu-int4.bin';
        
        // Quick check if the file actually exists locally
        let check = await fetch(modelUrl, { method: 'HEAD' });
        if (!check.ok) {
            // Check fallback in root public directory in case they didn't make a models folder
            modelUrl = '/gemma-2b-it-gpu-int4.bin';
            check = await fetch(modelUrl, { method: 'HEAD' });
            if (!check.ok) {
                throw new Error(`Model file not found. You must download the TFLite variation from Kaggle and place it in the public/models directory.`);
            }
        }

        log('Downloading 2GB weights from local server cache...', 'text-yellow-400');
        
        LlmInference.createFromOptions(genaiFileset, {
            baseOptions: {
                modelAssetPath: modelUrl
            },
            maxTokens: 512,
            topK: 1,
        }).then(llm => {
            llmInference = llm;
            log('Gemma 2B loaded into NPU/GPU successfully!', 'text-blue-400');
            progressContainer.classList.add('hidden');
            progressText.classList.add('hidden');
            downloadModelBtn.classList.add('hidden');
            
            startBtn.disabled = false;
            startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            updateStatus('READY (OFFLINE)', 'bg-blue-100 text-blue-700 border-blue-200');
        }).catch(err => {
            throw err;
        });

    } catch (error) {
        log(`Failed: ${error.message}`, 'text-red-500');
        progressText.innerHTML = "<b>Missing Model File!</b> Please read the log instructions.";
        progressText.classList.add('text-red-500');
        downloadModelBtn.disabled = false;
        downloadModelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
});


// 2. Audio/Video Capture and Local Speech Recognition
async function startStream() {
    try {
        log('Requesting camera and microphone access...', 'text-yellow-400');
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' },
            audio: true 
        });
        
        webcam.srcObject = mediaStream;
        webcam.classList.remove('hidden');
        cameraPlaceholder.classList.add('hidden');
        
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        recordingIndicator.classList.remove('hidden');
        
        setupLocalSpeechRecognition();
        updateStatus('TRANSLATING (EDGE)', 'bg-green-100 text-green-700 border-green-200');
        isTranslating = true;
    } catch (err) {
        log(`Media error: ${err.message}`, 'text-red-400');
    }
}

function stopStream() {
    isTranslating = false;
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (recognition) {
        recognition.stop();
    }
    
    webcam.classList.add('hidden');
    cameraPlaceholder.classList.remove('hidden');
    
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
    updateStatus('READY (OFFLINE)', 'bg-blue-100 text-blue-700 border-blue-200');
    log('Stream stopped.', 'text-gray-400');
}

// Offline STT using Web Speech API
function setupLocalSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        log('Offline Speech Recognition not supported in this browser.', 'text-red-400');
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    
    recognition.onresult = async (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        log(`User (STT): "${transcript}"`, 'text-gray-300');
        
        if (llmInference) {
            runLocalInference(transcript);
        }
    };
    
    recognition.onerror = (event) => {
        log(`STT Error: ${event.error}`, 'text-red-400');
    };
    
    recognition.start();
    log('Listening for offline translation...', 'text-purple-400');
}

// 3. Local WebGPU LLM Inference
async function runLocalInference(text) {
    try {
        log(`Generating response via Gemma...`, 'text-yellow-300');
        const prompt = `Translate or respond to the following clearly: ${text}`;
        
        // This runs 100% locally on the device GPU
        const response = await llmInference.generateResponse(prompt);
        log(`Gemma Edge: ${response}`, 'text-blue-300');
        
        // Local TTS
        const utterance = new SpeechSynthesisUtterance(response);
        window.speechSynthesis.speak(utterance);
        
    } catch (e) {
        log(`Inference failed: ${e.message}`, 'text-red-500');
    }
}

startBtn.addEventListener('click', startStream);
stopBtn.addEventListener('click', stopStream);
