
export function parseErrorMessage(error: unknown): string {
    const defaultMessage = 'An unexpected error occurred. Please check the console for details.';
    if (!(error instanceof Error)) {
        return defaultMessage;
    }
    
    const errorMessage = error.message.toLowerCase();
    
    // Check for Abort errors first
    if (error.name === 'AbortError' || errorMessage.includes('aborted')) {
        return 'Aborted';
    }

    if (errorMessage.includes('the caller does not have permission')) {
        return "API Key error: Your selected key does not have permission for this model. Please select a key from a project with the Generative AI API enabled.";
    }

    // Gemini API often returns a JSON string in the error message
    try {
        const parsed = JSON.parse(error.message);
        if (parsed.error) {
            // Handle cases where message is present
            if (parsed.error.message) {
                 if (typeof parsed.error.message === 'string' && parsed.error.message.toLowerCase().includes('quota')) {
                    return `Quota exceeded. ${parsed.error.message}`;
                }
                return parsed.error.message;
            }
            // Handle cases where message is empty but code/status exists (e.g. 500 Internal Server Error)
            if (parsed.error.code === 500 || (parsed.error.status && parsed.error.status.includes('Internal Server Error'))) {
                return 'The AI model encountered an internal server error. Please try your request again.';
            }
        }
    } catch (e) {
        // Not a JSON string, proceed with string matching on the original message.
    }


    if (errorMessage.includes('api key not valid')) {
        return 'Invalid API Key. Please ensure your API key is correct and has the necessary permissions.';
    }
    if (errorMessage.includes('blocked') || errorMessage.includes('safety')) {
        return 'Your prompt was blocked due to the content policy. Please modify your prompt and try again.';
    }
    if (errorMessage.includes('429') || errorMessage.includes('resource_exhausted') || errorMessage.includes('rate limit')) {
        return "You've exceeded your quota. Please check your plan and billing details, then try again.";
    }
    if (errorMessage.includes('503') || errorMessage.includes('unavailable') || errorMessage.includes('overloaded')) {
        return 'The model is temporarily unavailable or overloaded. Please try again later.';
    }
    if (errorMessage.includes("requested entity was not found")) {
        return "API Key error. The selected API key may not have access to this model. Please try selecting your key again.";
    }
    
    // Keep the original message if it's none of the above but still informative.
    return error.message || defaultMessage;
}
