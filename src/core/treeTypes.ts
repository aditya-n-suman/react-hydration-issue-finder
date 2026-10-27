/** Minimal shapes aligned with parse5 default tree adapter */

export type P5Text = { nodeName: "#text"; value: string };
export type P5Comment = { nodeName: "#comment"; data: string };
export type P5DocumentType = { nodeName: "#documentType" };

export type P5Element = {
  nodeName: string;
  tagName: string;
  attrs: { name: string; value: string }[];
  childNodes?: P5Child[];
};

export type P5Child = P5Element | P5Text | P5Comment | P5DocumentType | { nodeName: string; childNodes?: P5Child[] };

export type P5Document = {
  nodeName: "#document";
  childNodes?: P5Child[];
};

export function isP5Element(n: P5Child): n is P5Element {
  return typeof (n as P5Element).tagName === "string" && (n as P5Element).tagName !== "";
}
