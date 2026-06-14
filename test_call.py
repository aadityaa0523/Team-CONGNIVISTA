import sys
sys.path.insert(0, '.')
from backend.config import settings
from twilio.rest import Client

client = Client(settings.twilio_account_sid, settings.twilio_auth_token)

twiml = '<Response><Say voice="alice" language="en-IN">HydroMind flood alert. Water level at Krishna River is critically high. Please evacuate immediately.</Say></Response>'

call = client.calls.create(
    twiml=twiml,
    to='+917200576432',
    from_='+19843721135'
)
print('Call SID:', call.sid, '| Status:', call.status)
