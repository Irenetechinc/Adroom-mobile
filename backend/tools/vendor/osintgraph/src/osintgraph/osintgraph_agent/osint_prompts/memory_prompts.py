from langchain_core.prompts.chat import ChatPromptTemplate

CUSTOM_INITIAL_SUMMARY_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("placeholder", "{messages}"),
        (
            "user",
            "Summarize the conversation above using a concise turn-by-turn format. "
            "For each message, indicate the speaker (User or AI), and provide a short summary of their message. "
            "Example:\n"
            "User: [short summary of user message]\n"
            "AI: [short summary of AI reply]\n"
            "Tool: [tool name used] → [short summary of what was done and what result was returned]\n\n"
            "Include all key reasoning steps, queries, and responses. Be accurate and concise."
            "Summarize only the conversation turns clearly and concisely, starting directly and ending with the last message — no intro or closing lines."
        ),
    ]
)

# For updating an existing summary
CUSTOM_EXISTING_SUMMARY_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("placeholder", "{messages}"),
        (
            "user",
            "Here is the current summary of the conversation so far:\n{existing_summary}\n\n"
            "Update and extend this summary using the new messages above, keeping the same turn-by-turn format. "
            "Summarize each message concisely, labeling it clearly as 'User:' or 'AI:' or 'Tool:'."
            "Summarize only the conversation turns clearly and concisely, starting directly and ending with the last message — no intro or closing lines."
        ),
    ]
)