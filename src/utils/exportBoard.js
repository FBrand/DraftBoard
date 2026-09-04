// html2canvas is the single biggest thing in the bundle and is needed only
// when someone actually exports a board image — a button that lives in Focus
// mode. Importing it lazily keeps it out of the initial download, which
// matters most for viewers who will never press it.
export const exportBoardToImage = async (elementId = 'center-board-container') => {
    const element = document.querySelector(`.${elementId}`);
    if (!element) {
        console.error('Export target not found');
        return;
    }

    // Add export class to body to trigger "clean" layout (hide sidebars, etc.)
    document.body.classList.add('export-mode');

    try {
        const { default: html2canvas } = await import('html2canvas');

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
        // Rethrown rather than alert()ed so the calling component can surface
        // it through the app's own Toast, like every other error path.
        throw new Error('Could not generate the board image. Try "Print Board" (Ctrl+P) instead.');
    } finally {
        document.body.classList.remove('export-mode');
    }
};
