from rich.console import Group
from rich.markdown import Markdown
from rich.text import Text

# helper class for status
class StatusList:
    def __init__(self, initial=None):
        self.items = []
        if initial:
            self += initial  # allow initial assignment

    def __iadd__(self, other):
        # allow string or any renderable
        if isinstance(other, str):
            other = Text.from_markup(other)
        self.items.append(other)
        return self

    def __iter__(self):
        return iter(self.items)

    def clear(self):
        self.items = []

    def set(self, other):
        """overwrite completely"""
        self.items = []
        self += other

    def render(self):
        return Group(*self.items) if self.items else None

class OutputText:
    def __init__(self, initial=""):
        self.text = initial  # always plain text
    
    def __iadd__(self, other):
        # append plain strings
        if isinstance(other, str):
            self.text += other
        else:
            # if someone passes a Markdown, extract its source
            self.text += str(other)
        return self
    
    def set(self, text):
        self.text = text
    
    def clear(self):
        self.text = ""
    
    def render(self):
        return Markdown(self.text) if self.text else None
    
class ConsoleUI:
    def __init__(self):
        self.status_text = StatusList()  # now supports = and +=
        self.output_text = OutputText()  # can use same class
        self._live = None

    def render(self):
        parts = []
        s = self.status_text.render()
        o = self.output_text.render()
        if s:
            parts.append(s)
        if o:
            parts.append(o)
        return Group(*parts)

    def refresh(self):
        if self._live:
            self._live.update(self.render())
            
ui = ConsoleUI()
