from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_core.rate_limiters import InMemoryRateLimiter

from ..credential_manager import get_credential_manager
cm = get_credential_manager()




if cm.get("GEMINI_API_KEY"):

    rate_limiter = InMemoryRateLimiter(
    requests_per_second=0.16, 
    check_every_n_seconds=0.5, 
    max_bucket_size=5
    )

    gemini_2_0_flash = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
    )

    gemini_2_0_flash_with_limit = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
        rate_limiter=rate_limiter
    )

    gemini_2_5_flash_lite_llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash-lite-preview-06-17",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
    )

    gemini_2_5_flash_lite_llm_with_limit = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash-lite-preview-06-17",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
        rate_limiter=rate_limiter
    )

    gemini_2_5_flash_llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
    )
    
    gemini_2_5_flash_llm_with_limit = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=cm.get("GEMINI_API_KEY"),
        temperature=0.0,
        rate_limiter=rate_limiter
    )


    text_embedding_004_llm = GoogleGenerativeAIEmbeddings(
        model="models/text-embedding-004",
        google_api_key=cm.get("GEMINI_API_KEY")
    )

else:
    gemini_2_0_flash = None
    gemini_2_0_flash_with_limit = None
    gemini_2_5_flash_lite_llm = None
    gemini_2_5_flash_lite_llm_with_limit = None
    gemini_2_5_flash_llm = None
    gemini_2_5_flash_llm_with_limit = None
    text_embedding_004_llm = None