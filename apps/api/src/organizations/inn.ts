export function validInn(value:unknown):value is string {
  if(typeof value!=='string'||!/^([0-9]{10}|[0-9]{12})$/.test(value)||/^0+$/.test(value))return false;
  const check=(weights:number[])=>weights.reduce((sum,weight,index)=>sum+weight*Number(value[index]),0)%11%10;
  return value.length===10 ? check([2,4,10,3,5,9,4,6,8])===Number(value[9])
    : check([7,2,4,10,3,5,9,4,6,8])===Number(value[10])&&check([3,7,2,4,10,3,5,9,4,6,8])===Number(value[11]);
}
