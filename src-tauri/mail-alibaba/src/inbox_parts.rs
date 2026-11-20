use super::*;
use imap_proto::types::{BodyContentCommon, BodyStructure, ContentEncoding, SectionPath};

const MAX_ATTACHMENT: usize = 25 * 1024 * 1024;
const MAX_ENCODED: usize = 36 * 1024 * 1024;

struct Part {
    path: Vec<u32>,
    header: String,
    kind: String,
    name: Option<String>,
    octets: usize,
}

fn parameters(header: &mut String, params: &Option<Vec<(&str, &str)>>) {
    for &(key, value) in params.iter().flatten() {
        if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b"-*".contains(&b))
            || value.chars().any(char::is_control) {continue;}
        header.push_str(&format!("; {key}=\"{}\"", value.replace('\\',"\\\\").replace('"',"\\\"")));
    }
}

fn content_header(common: &BodyContentCommon<'_>, transfer: &ContentEncoding<'_>) -> Result<String> {
    let token = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
    if !token(common.ty.ty) || !token(common.ty.subtype) {return Err("mail_mime_invalid");}
    let mut header = format!("Content-Type: {}/{}", common.ty.ty, common.ty.subtype);
    parameters(&mut header, &common.ty.params);
    if let Some(disposition) = &common.disposition {
        if !token(disposition.ty) {return Err("mail_mime_invalid");}
        header.push_str(&format!("\r\nContent-Disposition: {}",disposition.ty));
        parameters(&mut header, &disposition.params);
    }
    let transfer=match transfer {
        ContentEncoding::Base64=>"base64", ContentEncoding::QuotedPrintable=>"quoted-printable",
        ContentEncoding::Binary=>"binary",ContentEncoding::SevenBit=>"7bit",ContentEncoding::EightBit=>"8bit",
        ContentEncoding::Other(v) if token(v)=>v, _=>return Err("mail_mime_invalid"),
    };
    Ok(format!("{header}\r\nContent-Transfer-Encoding: {transfer}\r\n\r\n"))
}

fn collect(tree: &BodyStructure<'_>, path: &mut Vec<u32>, parts: &mut Vec<Part>) -> Result<()> {
    if path.len()>20 || parts.len()>=1024 {return Err("mail_mime_invalid");}
    let (common,other)=match tree {
        BodyStructure::Multipart{bodies,..}=>{
            for (i,child) in bodies.iter().enumerate(){
                path.push(i as u32 + 1);collect(child,path,parts)?;path.pop();
            }
            return Ok(());
        }
        BodyStructure::Basic{common,other,..} | BodyStructure::Text{common,other,..} | BodyStructure::Message{common,other,..}=>(common,other),
    };
    let header=content_header(common,&other.transfer_encoding)?;
    let description=MessageParser::new().parse(header.as_bytes()).ok_or("mail_mime_invalid")?;
    let kind=format!("{}/{}",common.ty.ty,common.ty.subtype).to_ascii_lowercase();
    let name=description.attachment_name().map(str::to_owned).or_else(||
        (common.disposition.as_ref().is_some_and(|d|d.ty.eq_ignore_ascii_case("attachment"))
         || !matches!(kind.as_str(),"text/plain"|"text/html")).then(||"attachment.bin".into()));
    parts.push(Part{path:if path.is_empty(){vec![1]}else{path.clone()},header,kind,name,octets:other.octets as usize});
    Ok(())
}

fn structure(session:&mut imap::Session<Bounded>, uid:u32)->Result<(Summary,Vec<Part>)>{
    let rows=session.uid_fetch(uid.to_string(),format!("(UID RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER]<0.{MAX_HEADER}>)")).map_err(|_|"mail_read_failed")?;
    let row=rows.iter().find(|r|r.uid==Some(uid)).ok_or("mail_message_missing")?;
    let header=MessageParser::new().parse_headers(row.header().ok_or("mail_protocol")?).ok_or("mail_mime_invalid")?;
    let summary=metadata(&header,uid,row.size.ok_or("mail_protocol")?);
    let mut parts=Vec::new();
    collect(row.bodystructure().ok_or("mail_protocol")?,&mut Vec::new(),&mut parts)?;
    Ok((summary,parts))
}

// Construct an independent MIME part from its typed BODYSTRUCTURE metadata and
// its transfer-encoded payload. Never fetch the whole message or a sibling part.
fn fetch_part(session:&mut imap::Session<Bounded>, uid:u32, part:&Part)->Result<Vec<u8>> {
    let section=part.path.iter().map(u32::to_string).collect::<Vec<_>>().join(".");
    let requested=part.octets+1;
    let rows=session.uid_fetch(uid.to_string(),format!("(UID BODY.PEEK[{section}]<0.{requested}>)")).map_err(|_|"mail_read_failed")?;
    let bytes=rows.iter().find(|r|r.uid==Some(uid)).and_then(|r|r.section(&SectionPath::Part(part.path.clone(),None))).ok_or("mail_protocol")?;
    if bytes.len()!=part.octets{return Err("mail_partial_message");}
    let mut mime=Vec::with_capacity(part.header.len()+bytes.len());
    mime.extend_from_slice(part.header.as_bytes());mime.extend_from_slice(bytes);Ok(mime)
}

impl Alibaba {
    pub(crate) fn letter(&self,address:&str,password:&str,validity:u32,uid:u32)->Result<Letter>{
        if uid==0 || validity==0{return Err("mail_invalid_uid");}
        let (mut session,epoch,_)=self.inbox(address,password)?;
        if epoch!=validity{return Err("mail_inbox_changed");}
        let (summary,parts)=structure(&mut session,uid)?;
        let mut text=None;let mut html=None;let mut html_as_text=None;
        let mut attachments=Vec::new();let mut remaining=MAX_MESSAGE;let mut body_limited=false;
        for part in parts {
            if let Some(name)=part.name {
                attachments.push(Attachment{id:attachments.len(),name,size:part.octets});continue;
            }
            let is_html=part.kind=="text/html";
            if (is_html && html.is_some()) || (!is_html && text.is_some()){continue;}
            if part.octets>remaining {body_limited=true;continue;}
            remaining-=part.octets;
            let mime=fetch_part(&mut session,uid,&part)?;
            let m=MessageParser::new().parse(&mime).ok_or("mail_mime_invalid")?;
            if is_html {
                html=m.root_part().text().map(|v|v.into_owned());
                html_as_text=m.body_text(0).map(|v|v.into_owned());
            } else { text=m.body_text(0).map(|v|v.into_owned()); }
        }
        Ok(Letter{summary,text:text.or(html_as_text).unwrap_or_default(),html,attachments,body_limited})
    }
    pub fn attachment(&self,address:&str,password:&str,validity:u32,uid:u32,expected:&Attachment)->Result<Vec<u8>>{
        if uid==0 || validity==0{return Err("mail_invalid_uid");}
        let (mut session,epoch,_)=self.inbox_with_limit(address,password,MAX_ENCODED+2*1024*1024)?;
        if epoch!=validity{return Err("mail_inbox_changed");}
        let (_,parts)=structure(&mut session,uid)?;
        let part=parts.iter().filter(|p|p.name.is_some()).nth(expected.id).ok_or("mail_attachment_missing")?;
        if part.name.as_ref()!=Some(&expected.name) || part.octets!=expected.size{return Err("mail_attachment_changed");}
        if part.octets>MAX_ENCODED{return Err("mail_message_too_large");}
        let mime=fetch_part(&mut session,uid,part)?;
        let m=MessageParser::new().parse(&mime).ok_or("mail_mime_invalid")?;
        let (bytes,problems)=m.root_part().decoded_checked();
        if !problems.is_empty(){return Err("mail_attachment_changed");}
        if bytes.len()>MAX_ATTACHMENT {return Err("mail_message_too_large");}
        Ok(bytes.into_owned())
    }
}
