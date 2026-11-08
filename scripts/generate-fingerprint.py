from pathlib import Path
import json,uuid,hashlib,datetime
from PIL import Image,ImageDraw
root=Path(r'C:\Users\BaoPC\Desktop\oled\fingerprint-lock')
font=json.loads((root/'font-generation.json').read_text('utf-8'))
meta=json.loads((root/'font-source-metadata.json').read_text('utf-8'))
resources=[{'id':'font-simsun-12','kind':'font','name':'宋体 12px · 指纹锁字符集','license':meta['names']['copyright']['en']+'\n'+meta['names']['license']['en']+'\n'+meta['names']['licenseURL']['en']+'\nOS/2 fsType=8 (Editable embedding). Firmware redistribution rights not confirmed.','coverage':font['coverage'],'size':12,'threshold':64,'dataPath':'resources/font-simsun-12.bin','sourcePath':'sources/font-simsun-12.bin','sourceName':'SimSun-01.ttf'}]
# Original fingerprint mark, drawn directly at target pixel size; per-row XBM packing.
im=Image.new('1',(29,35)); d=ImageDraw.Draw(im)
for inset in [0,4,8]:
 d.arc((1+inset,1+inset,27-inset,29-inset),180,360,fill=1)
 d.line((1+inset,15,1+inset,24-inset//2),fill=1)
 d.line((27-inset,15,27-inset,25),fill=1)
 d.arc((5+inset//2,17,27-inset,34-inset//2),0,95,fill=1)
d.line((13,13,13,23),fill=1); d.arc((5,17,21,33),0,95,fill=1);d.line((5,26,8,32),fill=1)
stride=4; data=bytearray(stride*35)
for y in range(35):
 for x in range(29):
  if im.getpixel((x,y)):data[y*stride+x//8]|=1<<(x%8)
(root/'resources/image-fingerprint.bin').write_bytes(data)
resources.append({'id':'image-fingerprint','kind':'image','name':'原创指纹 Logo','license':'Original artwork generated for this project; CC0-1.0.','width':29,'height':35,'dataPath':'resources/image-fingerprint.bin'})
# Preserve the example template's original resource and attribution, byte for byte.
(root/'resources/ai-image-icon.bin').write_bytes(bytes([1,16,1,16,1,16]))
resources.append({'id':'ai-image-icon','kind':'image','name':'Status bars','license':'Original geometric icon; provided with this example.','width':13,'height':3,'dataPath':'resources/ai-image-icon.bin'})
pages=[]; cur=None

def page(key,name):
 global cur
 cur={'id':'fl-page-'+key,'name':name,'background':0,'components':[]};pages.append(cur)
def add(kind,name,bit=1,**props):
 cur['components'].append(dict(id=cur['id']+'-c'+str(len(cur['components'])+1),name=name,type=kind,visible=True,locked=False,bit=bit,**props))
def zh(text,x,y,align='left',bit=1):add('chinese',text,bit,x=x,y=y,text=text,fontId='font-simsun-12',align=align,lineGap=0,transparent=True)
def asc(text,x,y,font='builtin-5x7',align='left',bit=1):add('ascii',text,bit,x=x,y=y,text=text,fontId=font,align=align,lineGap=0,transparent=True)
def line(x1,y1,x2,y2,name='分隔线'):add('line',name,points=[[x1,y1],[x2,y2]])
def rect(x,y,w,h,fill=False,bit=1,radius=0,name='框'):add('rect',name,bit,x=x,y=y,width=w,height=h,radius=radius,fill=fill)
def circle(x,y,r,fill=False,bit=1,name='指示点'):add('circle',name,bit,x=x,y=y,radius=r,fill=fill)
def logo(x,y):add('image','指纹 Logo',x=x,y=y,resourceId='image-fingerprint',transparent=True)
def header(title,index):
 zh(title,4,2);asc(index,123,5,align='right');line(4,16,123,16)
def footer(left='返回',right='确认'):
 line(4,49,123,49);zh(left,4,51);zh(right,124,51,align='right')

page('welcome','01 待机 · Logo / 时间')
asc('GUARD / 01',4,2);rect(105,3,17,7);rect(122,5,2,3,True);rect(107,5,10,3,True)
logo(6,15);zh('指纹锁',45,13);asc('08:30',45,28,'builtin-9x15');asc('2026-11-08',45,44)
line(4,53,123,53);asc('TOUCH TO UNLOCK',64,56,align='center')

page('home','02 Home · 密码输入')
header('输入密码','PIN');asc('6-DIGIT PIN',64,20,align='center')
for i in range(6):
 x=19+i*18;circle(x,37,5,i<3,name=f'密码位 {i+1}')
 if i==3:line(x-4,45,x+4,45,'当前输入位置')
footer('返回','开锁')

page('manage','03 指纹管理 · 菜单')
header('指纹管理','03/50');rect(3,19,122,14,True,radius=2,name='选中菜单底色');zh('添加指纹',14,20,bit=0);asc('+',116,23,bit=0)
zh('指纹列表',14,35);asc('>',116,38);footer('返回','确认')

page('list','04 指纹列表 · 用户')
header('指纹列表','03/50');rect(3,19,122,14,True,radius=2,name='选中用户底色')
asc('01',7,23,bit=0);zh('管理员',27,20,bit=0);asc('ADMIN',119,23,align='right',bit=0)
asc('02',7,38);zh('用户',27,35);asc('USER',119,38,align='right');footer('返回','删除')

page('enroll','05 添加指纹 · 录入进度')
header('添加指纹','02/03');logo(6,20);zh('请放手指',47,21);asc('SCAN 02 / 03',47,36)
rect(47,46,76,5);rect(49,48,47,1,True,name='录入进度')
asc('ESC:CANCEL',4,56);asc('HOLD STILL',124,56,align='right')

page('delete','06 删除指纹 · 二次确认')
header('删除确认','ID:02');zh('删除指纹',64,21,align='center');zh('不可恢复',64,35,align='center')
rect(3,50,54,14,False,radius=2,name='保留按钮');zh('保留',30,51,align='center');rect(71,50,54,14,True,radius=2,name='删除按钮');zh('删除',98,51,align='center',bit=0)

page('success','07 开锁成功')
circle(25,25,16,name='成功状态圆');add('line','对勾短边',points=[[16,25],[23,32]]);add('line','对勾长边',points=[[23,32],[35,18]])
zh('开锁成功',51,15);zh('欢迎回家',51,31);line(4,49,123,49);asc('AUTO LOCK IN 5s',64,56,align='center')

page('denied','08 验证失败 · 重试')
circle(25,25,16,name='失败状态圆');line(18,18,32,32,'叉号1');line(18,32,32,18,'叉号2');zh('验证失败',51,15);zh('请重试',51,31);asc('2 LEFT',123,41,align='right');footer('返回','确认')

page('settings','09 系统设置')
header('系统设置','SET');zh('自动上锁',5,21);asc('05s',122,24,'builtin-6x10',align='right');zh('提示音',5,35);rect(87,34,37,14,True,radius=2,name='提示音开关');zh('开启',105,35,align='center',bit=0);footer('返回','确认')

page('locked','10 已上锁 · 状态')
# Editable lock icon, not a flattened page image.
rect(16,15,18,20,False,radius=7,name='锁梁');rect(10,27,30,20,True,radius=3,name='锁体');circle(25,35,2,True,bit=0,name='钥匙孔');rect(24,35,3,7,True,bit=0,name='钥匙槽')
zh('已上锁',51,18);asc('SYSTEM SECURE',51,35);line(4,49,123,49);zh('请按指纹',64,51,align='center')
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
proj=dict(schemaVersion=1,id='fingerprint-lock-'+str(uuid.uuid4()),name='GUARD 指纹锁 · 128×64',description='10 页可编辑单色指纹锁界面。时间、密码位、用户和进度为静态设计示例，运行逻辑由固件实现。原宋体许可完整保留。',createdAt=now,modifiedAt=now,display=dict(width=128,height=64,rotation=0,coordinateBits=16,bufferMode='full',controller='SSD1306'),pages=pages,defaultPageId='fl-page-welcome',resources=resources)
for r in resources:
 for prefix in ['data','source']:
  if prefix+'Path' in r:
   b=(root/r[prefix+'Path']).read_bytes();r[prefix+'Length']=len(b);r[prefix+'Hash']=hashlib.sha256(b).hexdigest()
covered=set(font['coverage']);needed={ord(c) for p in pages for el in p['components'] if el['type']=='chinese' for c in el['text'] if c!='\n'}
assert needed<=covered,needed-covered
(root/'project.json').write_text(json.dumps(proj,ensure_ascii=False,indent=2),encoding='utf-8')
print('Pages:',len(pages),'components:',sum(len(p['components']) for p in pages),'Chinese glyphs used:',len(needed),'font coverage:',len(covered))
print(root/'project.json')
