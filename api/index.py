"""Vercel Python Function entry point. Never exposes local project endpoints."""
from web import HostedHandler


class handler(HostedHandler):
    pass
