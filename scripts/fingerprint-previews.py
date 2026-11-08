from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(r'C:\Users\BaoPC\Desktop\oled\fingerprint-lock')
labels=['01  STANDBY / LOGO + CLOCK','02  HOME / PASSWORD','03  FINGERPRINT MANAGER','04  USERS / FINGERPRINTS','05  ENROLL / STEP 2 OF 3','06  DELETE CONFIRMATION','07  ACCESS GRANTED','08  ACCESS DENIED','09  SETTINGS','10  LOCKED']
scale=4;w=560;h=310
sheet=Image.new('RGB',(w*2,h*5),(18,22,27));d=ImageDraw.Draw(sheet)
for i,label in enumerate(labels):
 data=(root/f'previews/page-{i+1:02d}.raw').read_bytes();assert len(data)==8192
 im=Image.frombytes('L',(128,64),bytes(235 if v else 0 for v in data)).convert('RGB')
 im.save(root/f'previews/page-{i+1:02d}.png')
 x=(i%2)*w+24;y=(i//2)*h+12
 d.text((x,y),label,fill=(180,190,205),font=ImageFont.load_default(size=16))
 sheet.paste(im.resize((512,256),Image.Resampling.NEAREST),(x,y+30))
sheet.save(root/'previews/overview.png')
print(root/'previews/overview.png')
