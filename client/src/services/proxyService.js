import { API_URL } from '../config';

/**
 * Service to handle proxy generation requests.
 */
class ProxyService {
    /**
     * Request proxy generation for a video.
     * @param {string} videoPath - Relative path of the video.
     * @param {string} userId - ID of the user.
     * @returns {Promise<{ proxyPath: string, proxyUrl: string }>}
     */
    static async generateProxy(videoPath, userId) {
        try {
            const response = await fetch(`${API_URL}/api/proxy/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ videoPath, userId }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Proxy generation failed');
            }

            return await response.json();
        } catch (error) {
            console.error('[ProxyService] Error:', error);
            throw error;
        }
    }

    /**
     * Upload a video file to the server and trigger proxy generation.
     * @param {File} file - The video File object.
     * @param {string} userId - ID of the user.
     * @returns {Promise<{ proxyPath: string, proxyUrl: string }>}
     */
    static async uploadAndGenerateProxy(file, userId) {
        try {
            const formData = new FormData();
            formData.append('video', file);
            if (userId) formData.append('userId', userId);
            
            const response = await fetch(`${API_URL}/api/proxy/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            return await response.json();
        } catch(error) {
            console.error('[ProxyService Upload]', error);
            throw error;
        }
    }
}

export default ProxyService;
