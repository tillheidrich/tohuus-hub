import re,sys
tpl=open('/tmp/claude-0/house.svg.tpl').read()
L={'en':dict(label="Cross-section of a house. Pick a room to see what ToHuus Hub knows about it.",attic="Attic",bath="Bathroom",utility="Utility room",kitchen="Kitchen and fridge",pantry="Pantry",drinks="Cellar, drinks",freezer="Cellar, chest freezer"),
   'de':dict(label="Querschnitt durch ein Haus. Wähl einen Raum und sieh, was ToHuus Hub darüber weiß.",attic="Dachboden",bath="Bad",utility="Hauswirtschaftsraum",kitchen="Küche und Kühlschrank",pantry="Speisekammer",drinks="Keller, Getränke",freezer="Keller, Gefriertruhe")}
for lang,path in [('en','/home/claude/stockwerk/site/index.html'),('de','/home/claude/stockwerk/site/de/index.html')]:
    try: h=open(path).read()
    except: continue
    if '<!--HOUSE-->' not in h: continue
    s=tpl
    for k,v in L[lang].items(): s=s.replace('{{'+k+'}}',v)
    h=re.sub(r'<!--HOUSE-->.*?<!--/HOUSE-->','<!--HOUSE-->\n'+s+'\n<!--/HOUSE-->',h,flags=re.S)
    open(path,'w').write(h); print('built',lang)
