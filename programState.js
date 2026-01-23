
const GARBAGE = Symbol("garbage");

class ProgramState{

   constructor() {
    this.stackTrace = [];
    this.heap = new Map();
    this.valuesDict = new Map();
    this.stackTraceLen = 0;
  }

  pushStackFrame(name = ""){
    this.stackTrace.push(new Stack(name, this.stackTraceLen));
    this.stackTraceLen = this.stackTraceLen + 1;
  }

  popStackFrame(){
    if(this.stackTraceLen > 0){
      this.stackTrace.pop();
      this.stackTraceLen = this.stackTraceLen - 1;
    }
  }

  getCurrStackFrame(){
    return this.stackTrace[this.stackTraceLen - 1];
  }

  toString(){
    let s = `================================================================================================\n`;
    s += `                                         STACK:                                                 \n`;
    s += `================================================================================================\n`;

    for(let i = 0; i < this.stackTraceLen; i++){
      s += `${this.stackTrace[i].toString()}\n`;
    }
    s += `\n\n`;

    s += `================================================================================================\n`;
    s += `                                          HEAP:                                                 \n`;
    s += `================================================================================================\n`;

    let keys = Array.from( this.heap.keys() );

    keys.sort((k) => parseInt(k));

    keys.forEach((k) => s += `${this.heap.get(k.toString(16)).toString()}`);

    return s;
  }
}

class Stack{

  constructor(name, stackTraceIndex){
    this.name = name;
    this.stackTraceIndex = stackTraceIndex;
    this.variablesLst = [];
  }

  toString(){
    let s = `\nStack Frame (${this.stackTraceIndex}): ${this.name}\n`;
    for(let i = 0; i < this.variablesLst.length; i++){
      s += `${this.variablesLst[i].toString()}`;
    }
    s += `\n\n`;
    return s;
  }
}

class Value{

  constructor(name = "", type = "", address = "", bytes = -1, stackTraceIndex = -1, stackIndex = -1, stackName = "", value = undefined){
    
    this.name = name;
    this.type = type;
    this.value = (value === undefined) ? GARBAGE: value;
    this.address = address;
    this.bytes = bytes;
    this.stackTraceIndex = stackTraceIndex;
    this.stackIndex = stackIndex;
    this.stackName = stackName;
    this.prevValLst = [];
    this.prevValLstLen = 0;
    this.isInArr = false;
    this.arrStartAddr = "";
    this.arrLen = 0;
    this.arrIndex = -1;
    this.isStruct = false;
    this.isField = false;
    this.structAddr = "";
  }

  toString(){
    let s = "";
    let sDescription = `${this.name} (${this.type}) :`;
    
    if(this.value !== GARBAGE){
      if(this.isStruct){
        s = sDescription;
        s += ` \n{\n`;
        for(let i = 0; i < this.value.length; i++){
          s += `  -${this.value[i].toString()}`;
        }
        s += `}\n`;
      }else if(this.isInArr && this.stackTraceIndex != -1){
        if(this.arrIndex == 0){
          s = sDescription;
          s += ` [`;
        }
        s += `${this.value}`;
        if(this.arrIndex == this.arrLen - 1){
          s += `]\n`;
        }
      }else{
        s = sDescription;
        s += ` ${this.value}\n`;
      }
    }else{
      s = sDescription;
      s += ` Garbage!\n`;
    }
    return s;
  }

  reverseVal(){
    this.value = this.prevValLst.pop()
    this.prevValLstLen = this.prevValLstLen - 1;
  }

  assignVal(value = null){
    this.prevValLst.push(this.value)
    this.prevValLstLen = this.prevValLstLen + 1;
    this.value = value;
  }

  initStruct() {
    this.isStruct = true;
  }

  initField(structAddr = ""){
    this.isField = true;
    this.structAddr = structAddr;
  }

  initArrElem(arrIndex = -1, arrLen = 0, arrStartAddr = ""){
    this.isInArr = true;
    this.arrIndex = arrIndex;
    this.arrLen = arrLen;
    this.arrStartAddr = arrStartAddr;
  }
}

function testProgramState(){
   
  const prgState = new ProgramState();

  const v1 = new Value("a", "char *", "0x877", 8, 0, 0, "main", "0x123");
  const v2 = new Value("b", "int *", "0x222", 1, 0, 1, "main", "0x456");
  const v3 = new Value("num", "int", "0x498", 4, 0, 1, "main", 4);

  prgState.valuesDict.set(v1.address, v1);
  prgState.valuesDict.set(v2.address, v2);
  prgState.valuesDict.set(v3.address, v3);

  const h1a = new Value("", "int", "0x222", 8, -1, -1, "", 8);
  const h1b = new Value("", "int", "0x226", 8, -1, -1, "", 21);
  const h1c = new Value("", "int", "0x230", 8, -1, -1, "", 10);
  const h1d = new Value("", "int", "0x234", 8, -1, -1, "", 14);
  const h1e = new Value("", "int", "0x238", 8, -1, -1, "", 18);
  const h1f = new Value("", "int", "0x242", 8, -1, -1, "", 2);
  const h1g = new Value("", "int", "0x246", 8, -1, -1, "", 9);
  const h1h = new Value("", "int", "0x250", 8, -1, -1, "", 25);

  const h2a = new Value("", "char", "0x123", 8, -1, -1, "", "H");
  const h2b = new Value("", "char", "0x124", 8, -1, -1, "", "e");
  const h2c = new Value("", "char", "0x125", 8, -1, -1, "", "l");
  const h2d = new Value("", "char", "0x126", 8, -1, -1, "", "l");
  const h2e = new Value("", "char", "0x127", 8, -1, -1, "", "o");
  const h2f = new Value("", "char", "0x128", 8, -1, -1, "", " ");
  const h2g = new Value("", "char", "0x129", 8, -1, -1, "", "W");
  const h2h = new Value("", "char", "0x130", 8, -1, -1, "", "o");
  const h2i = new Value("", "char", "0x131", 8, -1, -1, "", "r");
  const h2j = new Value("", "char", "0x132", 8, -1, -1, "", "l");
  const h2k = new Value("", "char", "0x133", 8, -1, -1, "", "d");
  const h2l = new Value("", "char", "0x134", 8, -1, -1, "", "!");
  const h2m = new Value("", "char", "0x135", 8, -1, -1, "", "\\0");


  h1a.initArrElem(0, 8, "0x222");
  h1b.initArrElem(1, 8, "0x222");
  h1c.initArrElem(2, 8, "0x222");
  h1d.initArrElem(3, 8, "0x222");
  h1e.initArrElem(4, 8, "0x222");
  h1f.initArrElem(5, 8, "0x222");
  h1g.initArrElem(6, 8, "0x222");
  h1h.initArrElem(7, 8, "0x222");

  h2a.initArrElem(0, 13, "0x123");
  h2b.initArrElem(1, 13, "0x123");
  h2c.initArrElem(2, 13, "0x123");
  h2d.initArrElem(3, 13, "0x123");
  h2e.initArrElem(4, 13, "0x123");
  h2f.initArrElem(5, 13, "0x123");
  h2g.initArrElem(6, 13, "0x123");
  h2h.initArrElem(7, 13, "0x123");
  h2i.initArrElem(8, 13, "0x123");
  h2j.initArrElem(9, 13, "0x123");
  h2k.initArrElem(10, 13, "0x123");
  h2l.initArrElem(11, 13, "0x123");
  h2m.initArrElem(12, 13, "0x123");

  prgState.heap.set(h1a.address, h1a);
  prgState.heap.set(h1b.address, h1b);
  prgState.heap.set(h1c.address, h1c);
  prgState.heap.set(h1d.address, h1d);
  prgState.heap.set(h1e.address, h1e);
  prgState.heap.set(h1f.address, h1f);
  prgState.heap.set(h1g.address, h1g);
  prgState.heap.set(h1h.address, h1h);

  prgState.heap.set(h2a.address, h2a);
  prgState.heap.set(h2b.address, h2b);
  prgState.heap.set(h2c.address, h2c);
  prgState.heap.set(h2d.address, h2d);
  prgState.heap.set(h2e.address, h2e);
  prgState.heap.set(h2f.address, h2f);
  prgState.heap.set(h2g.address, h2g);
  prgState.heap.set(h2h.address, h2h);
  prgState.heap.set(h2i.address, h2i);
  prgState.heap.set(h2j.address, h2j);
  prgState.heap.set(h2k.address, h2k);
  prgState.heap.set(h2l.address, h2l);
  prgState.heap.set(h2m.address, h2m);

  prgState.valuesDict.set(h1a.address, h1a);
  prgState.valuesDict.set(h1b.address, h1b);
  prgState.valuesDict.set(h1c.address, h1c);
  prgState.valuesDict.set(h1d.address, h1d);
  prgState.valuesDict.set(h1e.address, h1e);
  prgState.valuesDict.set(h1f.address, h1f);
  prgState.valuesDict.set(h1g.address, h1g);
  prgState.valuesDict.set(h1h.address, h1h);

  prgState.valuesDict.set(h2a.address, h2a);
  prgState.valuesDict.set(h2b.address, h2b);
  prgState.valuesDict.set(h2c.address, h2c);
  prgState.valuesDict.set(h2d.address, h2d);
  prgState.valuesDict.set(h2e.address, h2e);
  prgState.valuesDict.set(h2f.address, h2f);
  prgState.valuesDict.set(h2g.address, h2g);
  prgState.valuesDict.set(h2h.address, h2h);
  prgState.valuesDict.set(h2i.address, h2i);
  prgState.valuesDict.set(h2j.address, h2j);
  prgState.valuesDict.set(h2k.address, h2k);
  prgState.valuesDict.set(h2l.address, h2l);
  prgState.valuesDict.set(h2m.address, h2m);

  // const stack1 = new Stack("main", 0);
  prgState.pushStackFrame("main");

  prgState.getCurrStackFrame().variablesLst.push(v1, v2, v3);

  // const stack2 = new Stack("f1", 1);
  prgState.pushStackFrame("f1");

  const v4 = new Value("c", "int", "0x566", 4, 1, 0, "f1", 0);
  const v5 = new Value("d", "char *", "0x999", 4, 1, 1, "f1", null);

  prgState.valuesDict.set(v4.address, v4);
  prgState.valuesDict.set(v5.address, v5);

  prgState.getCurrStackFrame().variablesLst.push(v4, v5);

  const fieldLst = [];

  const field1a = new Value("name", "char", "0x115", 1, 1, 2, "f1", "B");
  const field1b = new Value("name", "char", "0x116", 1, 1, 2, "f1", "o");
  const field1c = new Value("name", "char", "0x117", 1, 1, 2, "f1", "b");
  const field1d = new Value("name", "char", "0x118", 1, 1, 2, "f1", "\\0");

  field1a.initArrElem(0, 4, "0x115");
  field1b.initArrElem(1, 4, "0x115");
  field1c.initArrElem(2, 4, "0x115");
  field1d.initArrElem(3, 4, "0x115");

  field1a.initField("0x110");
  field1b.initField("0x110");
  field1c.initField("0x110");
  field1d.initField("0x110");

  prgState.valuesDict.set(field1a.address, field1a);
  prgState.valuesDict.set(field1b.address, field1b);
  prgState.valuesDict.set(field1c.address, field1c);
  prgState.valuesDict.set(field1d.address, field1d);


  const field2 = new Value("age", "int", "0x119", 4, 1, 2, "f1", 23);
  const field3 = new Value("isAlive", "int", "0x124", 4, 1, 2, "f1", 0);

  field2.initField("0x110");
  field3.initField("0x110");

  prgState.valuesDict.set(field2.address, field2);
  prgState.valuesDict.set(field3.address, field3);

  fieldLst.push(field1a, field1b, field1c, field1d, field2, field3);

  const personStruct = new Value("personStruct1", "personStruct", "0x110", 25, 1, 2, "f1", fieldLst);

  personStruct.initStruct();

  prgState.valuesDict.set(personStruct.address, personStruct);

  prgState.getCurrStackFrame().variablesLst.push(personStruct);

  console.log(`${prgState.toString()}`);
}

testProgramState()