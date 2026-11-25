/**
 * Caption and text fonts shared by the video editor and Design Studio.
 * Served by Bunny Fonts so opening either editor does not load fonts from Google.
 */
export const EDITOR_FONT_FAMILIES = [
    'Anton', 'Bebas Neue', 'Montserrat', 'Inter', 'Barlow Condensed',
    'Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display',
    'Cormorant Garamond', 'DM Sans', 'Unbounded', 'Nunito', 'Poppins',
    'Quicksand', 'Josefin Sans', 'Raleway', 'Rajdhani', 'Exo 2', 'Orbitron',
    'Oxanium', 'Roboto Condensed', 'Oswald', 'Teko', 'Black Han Sans',
    'Saira Condensed', 'Cabin', 'Caveat', 'Pacifico', 'Kalam', 'Satisfy',
    'Dancing Script', 'Boogaloo', 'Righteous', 'Press Start 2P', 'Audiowide',
    'Outfit', 'Roboto', 'Lato',
];

const EDITOR_FONTS_URL =
    'https://fonts.bunny.net/css?family=anton:400|bebas-neue:400|montserrat:300,400,500,600,700,800,900|inter:300,400,500,600,700,800|barlow-condensed:600,700|playfair-display:400,700,400i,700i|lora:400,700|merriweather:300,400,700,400i|dm-serif-display:400|cormorant-garamond:400,600,700,400i,600i,700i|dm-sans:400,500,600|unbounded:700,900|nunito:400,600,700,800|poppins:400,500,600,700|quicksand:400,500,700|josefin-sans:400,700|raleway:400,500,700|rajdhani:500,600,700|exo-2:600,700,800|orbitron:700,900|oxanium:600,700|roboto-condensed:400,700|oswald:400,500,600,700|teko:500,600,700|black-han-sans:400|saira-condensed:700,800|cabin:600,700|caveat:400,600,700|pacifico:400|kalam:400,700|satisfy:400|dancing-script:400,700|boogaloo:400|righteous:400|press-start-2p:400|audiowide:400|outfit:300,400,500,600,700,800|roboto:300,400,500,700|lato:300,400,700&display=swap';

export function ensureEditorFonts() {
    if (typeof document === 'undefined' || document.getElementById('vibed-editor-fonts')) return;

    if (!document.getElementById('vibed-fonts-pc1')) {
        const preconnect = document.createElement('link');
        preconnect.rel = 'preconnect';
        preconnect.href = 'https://fonts.bunny.net';
        preconnect.crossOrigin = 'anonymous';
        preconnect.id = 'vibed-fonts-pc1';
        document.head.appendChild(preconnect);
    }

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = EDITOR_FONTS_URL;
    stylesheet.id = 'vibed-editor-fonts';
    document.head.appendChild(stylesheet);
}
