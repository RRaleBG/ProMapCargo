using ProMapCargo.Api.Models;
namespace ProMapCargo.Api.Routing;
public sealed class PostGisAStarRouter(PostGisRoutingRepository repo,TruckEdgeEvaluator evaluator,TurnRestrictionMatcher restrictions)
{
    public async Task<PostGisRouteResult> RouteAsync(SnapResult start,SnapResult end,TruckProfile truck,long version,CancellationToken ct) {
        var startNode=start.Fraction<0.5?start.SourceNode:start.TargetNode;
        var goalNode=end.Fraction<0.5?end.SourceNode:end.TargetNode;
        if(start.EdgeId==end.EdgeId) {
            var forward=end.Fraction>=start.Fraction;
            var edge=(await repo.GetEdgesByIdsAsync([start.EdgeId],version,ct)).FirstOrDefault();
            if(edge is null)return new(false,[],0,0,0,"PostGIS-AStar","Edge not found");
            if((forward&&!start.CanTravelForward)||(!forward&&!start.CanTravelReverse))return new(false,[],0,0,0,"PostGIS-AStar","One-way restriction");
            var d=Math.Abs(end.Fraction-start.Fraction)*start.EdgeLengthM;
            var sec=d/(evaluator.Speed(edge,truck)/3.6);
            return new(true,[new RoutedTraversal(edge.Id,edge.SourceNode,edge.TargetNode,forward,d,sec)],d,sec,1,"PostGIS-AStar",null);
        }
        var restrictionSet=await restrictions.LoadAsync(version,ct);
        var pq=new PriorityQueue<(long node,long? previousWay),double>();
        var dist=new Dictionary<(long,long?),double> {
            {
                (startNode,null),0
            }
        }
        ;
        var prev=new Dictionary<(long,long?),(long,long?,RoutedTraversal)>();
        pq.Enqueue((startNode,null),0);
        var expanded=0;
        while(pq.Count>0&&expanded<500000) {
            ct.ThrowIfCancellationRequested();
            var state=pq.Dequeue();
            var node=state.node;
            var previousWay=state.previousWay;
            expanded++;
            if(node==goalNode)break;
            if(!dist.TryGetValue(state,out var baseCost))continue;
            foreach(var (e,forward) in await repo.GetOutgoingAsync(node,version,ct)) {
                if(!evaluator.Allowed(e,truck,out _))continue;
                if(!restrictionSet.Allows(previousWay,e.WayId,node))continue;
                var next=forward?e.TargetNode:e.SourceNode;
                var sec=e.LengthM/(evaluator.Speed(e,truck)/3.6);
                var nd=baseCost+sec;
                var nextState=(next,(long?)e.WayId);
                if(!dist.TryGetValue(nextState,out var old)||nd<old) {
                    dist[nextState]=nd;
                    prev[nextState]=(node,previousWay,new RoutedTraversal(e.Id,e.SourceNode,e.TargetNode,forward,e.LengthM,sec));
                    pq.Enqueue(nextState,nd);
                }
            }
        }
        var goalState=dist.Keys.Where(x=>x.Item1==goalNode).OrderBy(x=>dist[x]).FirstOrDefault();
        if(goalState==default&&startNode!=goalNode)return new(false,[],0,0,expanded,"PostGIS-AStar","Ruta nije pronađena.");
        var rev=new List<RoutedTraversal>();
        var cursor=goalState;
        while(cursor.Item1!=startNode||cursor.Item2!=null) {
            var p=prev[cursor];
            rev.Add(p.Item3);
            cursor=(p.Item1,p.Item2);
            if(cursor.Item1==startNode&&cursor.Item2==null)break;
        }
        rev.Reverse();
        return new(true,rev,rev.Sum(x=>x.DistanceM),rev.Sum(x=>x.DurationS),expanded,"PostGIS-AStar",null);
    }
}
