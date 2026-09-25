# credential_manager.py
import json
import os
from .constants import CREDENTIALS_FILE

class CredentialManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CredentialManager, cls).__new__(cls)
            cls._instance._load_or_initialize()

        return cls._instance
    
    def _load_or_initialize(self):
        if not os.path.exists(CREDENTIALS_FILE):
            self.credentials = {
                "NEO4J_URI": "",
                "NEO4J_USERNAME": "",
                "NEO4J_PASSWORD": "",
                "INSTAGRAM_USERNAME": "",
                "INSTAGRAM_USER_AGENT": "",
                "GEMINI_API_KEY": ""
            }
            self._save()
        else:
            with open(CREDENTIALS_FILE, "r") as f:
                self.credentials = json.load(f)

    def reset(self, keys=None):
        """Reset all credentials or specific keys."""
        if keys is None:
            for k in self.credentials:
                self.credentials[k] = ""
        else:
            for k in keys:
                if k in self.credentials:
                    self.credentials[k] = ""
        self._save()

    def _save(self):
        with open(CREDENTIALS_FILE, "w") as f:
            json.dump(self.credentials, f, indent=4)

    def get(self, key):
        return self.credentials.get(key, "")
    
    def set(self, key, value):
        self.credentials[key] = value
        self._save()


_credential_manager_instance = CredentialManager()

def get_credential_manager():
    return _credential_manager_instance