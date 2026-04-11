import html2canvas from 'html2canvas';

export const exportBoardToImage = async (elementId = 'center-board-container') => {
    const element = document.querySelector(`.${elementId}`);
    if (!element) {
        console.error('Export target not found');
        return;
    }

    // Add export class to body to trigger "clean" layout (hide sidebars, etc.)
    document.body.classList.add('export-mode');

    try {
        // Wait for layout adjustments to settle
        await new Promise(resolve => setTimeout(resolve, 400));

        const canvas = await html2canvas(element, {
            scale: 1.5, // Better balance between quality and size
            useCORS: true,
            backgroundColor: '#0f172a',
            logging: false,
            windowWidth: element.scrollWidth,
            windowHeight: element.scrollHeight,
            imageTimeout: 15000
        });

        // Convert to JPEG with 0.8 quality for good compression
        const imgData = canvas.toDataURL('image/jpeg', 0.8);

        // Trigger download
        const link = document.createElement('a');
        link.download = 'Chiefs_Draft_Board_2026.jpg';
        link.href = imgData;
        link.click();

    } catch (err) {
        console.error('Image Export failed:', err);
        alert('Failed to generate image. Please try the "Print Board" (Ctrl+P) method instead.');
    } finally {
        document.body.classList.remove('export-mode');
    }
};
