import { useState, useEffect } from 'react';

/**
 * Hook to detect the current device type based on screen width and touch capabilities.
 */
export function useDeviceType() {
    const [deviceInfo, setDeviceInfo] = useState({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isTouch: false,
        screenWidth: typeof window !== 'undefined' ? window.innerWidth : 1024
    });

    useEffect(() => {
        const checkDevice = () => {
            const width = window.innerWidth;
            const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
            
            setDeviceInfo({
                isMobile: width < 768,
                isTablet: width >= 768 && width < 1024,
                isDesktop: width >= 1024,
                isTouch,
                screenWidth: width
            });
        };

        // Initial check
        checkDevice();

        // Listen for window resize
        window.addEventListener('resize', checkDevice);
        return () => window.removeEventListener('resize', checkDevice);
    }, []);

    return deviceInfo;
}

export default useDeviceType;
